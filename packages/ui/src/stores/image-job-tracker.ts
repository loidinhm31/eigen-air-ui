/**
 * Tracked image jobs: revision-monotonic snapshots, one poll chain per non-terminal job, coalesced
 * per-job refetch, and cancel. Store state stays in the image artifact store; this module only
 * reads/writes the `jobs` record and `lastError` through the injected host.
 *
 * Fences: every await is checked against the store `generation` AND the job's tracking token. A
 * token is created when a job is first tracked and dropped with it, so a result for a dropped (or
 * dropped and re-tracked) entry can never be installed. `signal.aborted` additionally rejects the
 * late result of a run that the coalescer retired (deadline) or reset.
 *
 * Server job ids are untrusted keys: `jobs` is a null-prototype record accessed via `ownValue`, so
 * `__proto__`/`constructor`/`toString` behave like any other id.
 */
import { IMAGE_TERMINAL_JOB_STATES, type ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import { getArtifactService } from "../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
} from "../adapters/factory/interfaces/IArtifactAdapter.js";
import {
  abortable,
  armDeadline,
  createCoalescer,
  type Coalescer,
  type CoalescerDeps,
} from "./image-refresh-coalescer.js";

export const IMAGE_JOB_POLL_MS = 2000;

export type SafeRecord<T> = Readonly<Record<string, T>>;

/** Null-prototype record: server-controlled keys cannot hit inherited members or `__proto__`. */
export const emptyRecord = <T>(): SafeRecord<T> => Object.create(null) as SafeRecord<T>;
/** Own-property lookup; `undefined` for missing keys, never an inherited value. */
export const ownValue = <T>(record: SafeRecord<T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
export const withOwn = <T>(record: SafeRecord<T>, key: string, value: T): SafeRecord<T> => {
  const next = Object.assign(Object.create(null) as Record<string, T>, record);
  next[key] = value;
  return next;
};
export const withoutOwn = <T>(record: SafeRecord<T>, key: string): SafeRecord<T> => {
  const next = Object.assign(Object.create(null) as Record<string, T>, record);
  delete next[key];
  return next;
};

const TRANSIENT_KINDS: Partial<Record<ArtifactAdapterErrorKind, true>> = {
  network: true,
  unavailable: true,
  aborted: true,
};
const DENIED_KINDS: Partial<Record<ArtifactAdapterErrorKind, true>> = {
  unauthorized: true,
  not_found: true,
};

export const kindOf = (err: unknown): ArtifactAdapterErrorKind =>
  err instanceof ArtifactAdapterError ? err.kind : "protocol";
/** network/unavailable/aborted: keep state, never renew leases, try again later. */
export const isTransientKind = (kind: ArtifactAdapterErrorKind): boolean =>
  TRANSIENT_KINDS[kind] === true;
/** unauthorized/not_found: the authority denied access; fail closed. */
export const isDeniedKind = (kind: ArtifactAdapterErrorKind): boolean =>
  DENIED_KINDS[kind] === true;
export const isJobTerminal = (job: ImageJobSnapshot): boolean =>
  IMAGE_TERMINAL_JOB_STATES.includes(job.state);

export interface JobTrackerDeps extends CoalescerDeps {
  jobPollMs: number;
}

export interface ImageJobSelector {
  jobId: string;
  sessionId: string;
  runId: string;
}

export interface JobTrackerHost {
  deps(): JobTrackerDeps;
  jobs(): SafeRecord<ImageJobSnapshot>;
  setJobs(next: SafeRecord<ImageJobSnapshot>): void;
  setLastError(kind: ArtifactAdapterErrorKind): void;
  generation(): number;
  activeSessionId(): string | null;
  /** A tracked job just became terminal: relist its session once. */
  onTerminal(sessionId: string): void;
}

export interface ImageJobTracker {
  /** Tracks/updates a job of the active session (revision-monotonic). Other sessions ignored. */
  track(snapshot: ImageJobSnapshot): void;
  /** Coalesced refetch of an already-tracked job of the active session; untracked = no-op. */
  refresh(selector: ImageJobSelector): Promise<void>;
  /** Cancel with the latest tracked revision; errors set only `lastError` (see `cancel` body). */
  cancel(jobId: string): Promise<void>;
  /** Coalesced refetch for a tracked NON-terminal job (hint path; never throws). */
  hint(jobId: unknown): void;
  /** Stops pollers, aborts runs, invalidates pending results. Does not touch store state. */
  reset(): void;
}

interface CancelAttempt {
  controller: AbortController;
  disarm: () => void;
}

/** Stops an attempt's deadline timer and aborts its signal (idempotent). */
const retire = (attempt: CancelAttempt): void => {
  attempt.disarm();
  attempt.controller.abort();
};

export function createImageJobTracker(host: JobTrackerHost): ImageJobTracker {
  const coalescers = new Map<string, Coalescer>();
  const pollTimers = new Map<string, unknown>();
  /** jobId -> in-flight cancel attempt (a dropped/reset entry aborts and loses its marker). */
  const cancelling = new Map<string, CancelAttempt>();
  /** jobId -> tracking token (identity of the current tracked entry). */
  const tokens = new Map<string, object>();

  const tokenFor = (jobId: string): object => {
    let token = tokens.get(jobId);
    if (!token) {
      token = {};
      tokens.set(jobId, token);
    }
    return token;
  };
  /** True while the same tracked entry of the same store generation is still installed. */
  const live = (jobId: string, gen: number, token: object): boolean =>
    host.generation() === gen &&
    tokens.get(jobId) === token &&
    ownValue(host.jobs(), jobId) !== undefined;

  const clearPoll = (jobId: string): void => {
    if (!pollTimers.has(jobId)) return;
    host.deps().clearTimer(pollTimers.get(jobId));
    pollTimers.delete(jobId);
  };

  const coalescer = (jobId: string): Coalescer => {
    let existing = coalescers.get(jobId);
    if (!existing) {
      existing = createCoalescer(
        host.deps,
        (signal) => runRefresh(jobId, signal),
        () => {
          if (ownValue(host.jobs(), jobId)) host.setLastError("aborted"); // deadline: transient
        }
      );
      coalescers.set(jobId, existing);
    }
    return existing;
  };

  const dropJob = (jobId: string): void => {
    coalescers.get(jobId)?.reset();
    coalescers.delete(jobId);
    clearPoll(jobId);
    const attempt = cancelling.get(jobId);
    if (attempt) retire(attempt);
    cancelling.delete(jobId);
    tokens.delete(jobId);
    host.setJobs(withoutOwn(host.jobs(), jobId));
  };

  /** One poll chain per tracked non-terminal job; stops when terminal, dropped, or fenced. */
  const schedulePoll = (jobId: string, gen: number, token: object): void => {
    const job = ownValue(host.jobs(), jobId);
    if (!live(jobId, gen, token) || !job || isJobTerminal(job) || pollTimers.has(jobId)) return;
    pollTimers.set(
      jobId,
      host.deps().setTimer(() => {
        pollTimers.delete(jobId);
        if (!live(jobId, gen, token)) return;
        void coalescer(jobId)
          .requestAndWait()
          .then(() => schedulePoll(jobId, gen, token));
      }, host.deps().jobPollMs)
    );
  };

  /** Installs a server snapshot (revision-monotonic); terminal => stop polling + relist once. */
  const apply = (snapshot: ImageJobSnapshot): void => {
    const jobs = host.jobs();
    const previous = ownValue(jobs, snapshot.job_id);
    if (previous && snapshot.revision < previous.revision) return;
    const token = tokenFor(snapshot.job_id);
    host.setJobs(withOwn(jobs, snapshot.job_id, snapshot));
    if (!isJobTerminal(snapshot)) {
      schedulePoll(snapshot.job_id, host.generation(), token);
      return;
    }
    clearPoll(snapshot.job_id);
    if (!previous || !isJobTerminal(previous)) host.onTerminal(snapshot.session_id);
  };

  const onPollError = (jobId: string, kind: ArtifactAdapterErrorKind): void => {
    host.setLastError(kind);
    // Transient: keep tracking (poll chain continues). Anything else: snapshot no longer trusted.
    if (!isTransientKind(kind)) dropJob(jobId);
  };

  async function runRefresh(jobId: string, signal: AbortSignal): Promise<void> {
    const job = ownValue(host.jobs(), jobId);
    if (!job) return;
    const gen = host.generation();
    const token = tokenFor(jobId);
    try {
      const snapshot = await getArtifactService().getJob(
        { jobId, sessionId: job.session_id, runId: job.run_id },
        { signal }
      );
      if (signal.aborted || !live(jobId, gen, token)) return;
      apply(snapshot);
    } catch (err) {
      if (signal.aborted || !live(jobId, gen, token)) return;
      onPollError(jobId, kindOf(err));
    }
  }

  const refresh = (selector: ImageJobSelector): Promise<void> => {
    const job = ownValue(host.jobs(), selector.jobId);
    if (!job || job.session_id !== selector.sessionId || job.run_id !== selector.runId)
      return Promise.resolve();
    if (host.activeSessionId() !== selector.sessionId) return Promise.resolve();
    return coalescer(selector.jobId).requestAndWait();
  };

  const cancel = async (jobId: string): Promise<void> => {
    const job = ownValue(host.jobs(), jobId);
    if (!job || isJobTerminal(job) || cancelling.has(jobId)) return;
    const gen = host.generation();
    const token = tokenFor(jobId);
    // One attempt = one controller. The deadline, a drop/reset (session switch/release) and the
    // adapter call itself share its signal; only the attempt that still owns the marker may clear
    // it, so a retired attempt can never block (or be mistaken for) a later one.
    const attempt: CancelAttempt = { controller: new AbortController(), disarm: () => undefined };
    const { signal } = attempt.controller;
    cancelling.set(jobId, attempt);
    const release = (): void => {
      if (cancelling.get(jobId) === attempt) cancelling.delete(jobId);
    };
    const current = (): boolean => !signal.aborted && live(jobId, gen, token);
    attempt.disarm = armDeadline(host.deps(), attempt.controller, () => {
      release(); // a fresh cancel may start now; the job stays tracked and polling continues
      if (live(jobId, gen, token)) host.setLastError("aborted");
    });
    try {
      const result = await abortable(
        signal,
        getArtifactService().cancelJob(
          {
            jobId,
            sessionId: job.session_id,
            runId: job.run_id,
            expectedRevision: job.revision,
          },
          { signal }
        )
      );
      if (!result || !current()) return;
      // 202 is "requested", never "killed": store exactly what the server returned and keep polling.
      apply(result.snapshot);
    } catch (err) {
      if (!current()) return;
      const kind = kindOf(err);
      host.setLastError(kind);
      // A failed cancel request says nothing about the job itself: keep tracking it, except when
      // the authority denied access (unauthorized/not_found). 409 refetches once, never retries.
      if (kind === "conflict")
        void refresh({ jobId, sessionId: job.session_id, runId: job.run_id });
      else if (isDeniedKind(kind)) dropJob(jobId);
    } finally {
      attempt.disarm();
      release();
    }
  };

  return {
    track: (snapshot) => {
      if (host.activeSessionId() === snapshot.session_id) apply(snapshot);
    },
    refresh,
    cancel,
    hint: (jobId) => {
      const tracked = typeof jobId === "string" ? ownValue(host.jobs(), jobId) : undefined;
      if (tracked && !isJobTerminal(tracked)) coalescer(tracked.job_id).request();
    },
    reset: () => {
      for (const c of coalescers.values()) c.reset();
      coalescers.clear();
      for (const handle of pollTimers.values()) host.deps().clearTimer(handle);
      pollTimers.clear();
      for (const attempt of cancelling.values()) retire(attempt);
      cancelling.clear();
      tokens.clear();
    },
  };
}
