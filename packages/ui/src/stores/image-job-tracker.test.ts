import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import { setArtifactService } from "../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
  type IArtifactAdapter,
} from "../adapters/factory/interfaces/IArtifactAdapter.js";
import {
  createImageJobTracker,
  emptyRecord,
  ownValue,
  withOwn,
  withoutOwn,
  type ImageJobTracker,
  type JobTrackerDeps,
  type SafeRecord,
} from "./image-job-tracker.js";

// --- deterministic harness: fake clock + manual timers + fake host/service ---

const clock = { t: 1000 };
const timers = new Map<number, { at: number; fn: () => void }>();
let timerSeq = 0;
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function advance(ms: number): Promise<void> {
  const target = clock.t + ms;
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, v]) => v.at <= target)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    clock.t = Math.max(clock.t, due[1].at);
    due[1].fn();
    await flush();
  }
  clock.t = target;
  await flush();
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const job = (
  id: string,
  state: ImageJobSnapshot["state"],
  revision: number,
  over: object = {}
): ImageJobSnapshot =>
  ({
    schema: "image_job.v1",
    job_id: id,
    session_id: "s1",
    run_id: "r1",
    state,
    revision,
    created_at_ms: 1,
    ...over,
  }) as unknown as ImageJobSnapshot;

const deps: JobTrackerDeps = {
  now: () => clock.t,
  setTimer: (fn, ms) => {
    const id = ++timerSeq;
    timers.set(id, { at: clock.t + ms, fn });
    return id;
  },
  clearTimer: (handle) => void timers.delete(handle as number),
  refreshSpacingMs: 1000,
  runDeadlineMs: 20_000,
  jobPollMs: 2000,
};

const svc = { getJob: vi.fn(), cancelJob: vi.fn() };
const state = {
  jobs: emptyRecord<ImageJobSnapshot>() as SafeRecord<ImageJobSnapshot>,
  lastError: undefined as ArtifactAdapterErrorKind | undefined,
  generation: 0,
  active: "s1" as string | null,
};
const onTerminal = vi.fn();
let tracker: ImageJobTracker;

/** What the store does on session switch / clear: bump generation, reset tracker, drop state. */
const release = () => {
  state.generation += 1;
  tracker.reset();
  state.jobs = emptyRecord();
};

beforeEach(() => {
  clock.t = 1000;
  timers.clear();
  timerSeq = 0;
  svc.getJob.mockReset();
  svc.cancelJob.mockReset();
  onTerminal.mockReset();
  state.jobs = emptyRecord();
  state.lastError = undefined;
  state.generation = 0;
  state.active = "s1";
  setArtifactService(svc as unknown as IArtifactAdapter);
  tracker = createImageJobTracker({
    deps: () => deps,
    jobs: () => state.jobs,
    setJobs: (jobs) => (state.jobs = jobs),
    setLastError: (kind) => (state.lastError = kind),
    generation: () => state.generation,
    activeSessionId: () => state.active,
    onTerminal,
  });
});

describe("safe record helpers", () => {
  it("never expose inherited members and treat __proto__ like any key", () => {
    let record = emptyRecord<number>();
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(ownValue(record, key)).toBeUndefined();
      record = withOwn(record, key, 7);
      expect(ownValue(record, key)).toBe(7);
    }
    expect(Object.keys(record).sort()).toEqual([
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "toString",
    ]);
    const without = withoutOwn(record, "__proto__");
    expect(ownValue(without, "__proto__")).toBeUndefined();
    expect(ownValue(record, "__proto__")).toBe(7); // immutable update
    expect(Object.getPrototypeOf(without)).toBeNull();
  });

  it("also guard plain objects installed by foreign code", () => {
    const plain = { r1: 1 } as SafeRecord<number>;
    expect(ownValue(plain, "constructor")).toBeUndefined();
    expect(ownValue(plain, "__proto__")).toBeUndefined();
    expect(ownValue(plain, "r1")).toBe(1);
  });
});

describe("tracking and polling", () => {
  it("tracks only active-session jobs and keeps the highest revision", () => {
    tracker.track(job("foreign", "running", 1, { session_id: "other" }));
    expect(Object.keys(state.jobs)).toEqual([]);
    tracker.track(job("j1", "running", 5));
    tracker.track(job("j1", "admitted", 2));
    expect(ownValue(state.jobs, "j1")!.revision).toBe(5);
  });

  it("polls every jobPollMs, stops at terminal and relists exactly once", async () => {
    tracker.track(job("j1", "running", 1));
    svc.getJob
      .mockResolvedValueOnce(job("j1", "running", 2))
      .mockResolvedValueOnce(job("j1", "succeeded", 3));
    await advance(1999);
    expect(svc.getJob).not.toHaveBeenCalled();
    await advance(1);
    expect(svc.getJob).toHaveBeenCalledWith(
      { jobId: "j1", sessionId: "s1", runId: "r1" },
      { signal: expect.any(AbortSignal) }
    );
    expect(onTerminal).not.toHaveBeenCalled();
    await advance(2000);
    expect(onTerminal).toHaveBeenCalledExactlyOnceWith("s1");
    tracker.track(job("j1", "succeeded", 3)); // same terminal snapshot again: no second relist
    await advance(30_000);
    expect(svc.getJob).toHaveBeenCalledTimes(2);
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("drops on non-transient poll errors, keeps polling through transient ones", async () => {
    tracker.track(job("j1", "running", 1));
    tracker.track(job("j2", "running", 1));
    svc.getJob.mockImplementation(async ({ jobId }: { jobId: string }) => {
      throw new ArtifactAdapterError(jobId === "j1" ? "not_found" : "network");
    });
    await advance(2000);
    expect(ownValue(state.jobs, "j1")).toBeUndefined();
    expect(ownValue(state.jobs, "j2")).toBeDefined();
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(3);
  });

  it("hint refetches only tracked non-terminal jobs, coalesced, and tolerates junk ids", async () => {
    tracker.track(job("j1", "running", 1));
    tracker.track(job("done", "succeeded", 9));
    svc.getJob.mockResolvedValue(job("j1", "running", 2));
    for (const id of ["untracked", "done", "constructor", "__proto__", 7, undefined, null])
      tracker.hint(id);
    expect(svc.getJob).not.toHaveBeenCalled();
    for (let i = 0; i < 50; i++) tracker.hint("j1");
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(svc.getJob).toHaveBeenCalledTimes(2);
  });

  it("refresh is a no-op for untracked jobs, mismatched selectors and inactive sessions", async () => {
    tracker.track(job("j1", "running", 1));
    svc.getJob.mockResolvedValue(job("j1", "running", 2));
    await tracker.refresh({ jobId: "nope", sessionId: "s1", runId: "r1" });
    await tracker.refresh({ jobId: "j1", sessionId: "s1", runId: "other" });
    await tracker.refresh({ jobId: "j1", sessionId: "other", runId: "r1" });
    await tracker.refresh({ jobId: "toString", sessionId: "s1", runId: "r1" });
    expect(svc.getJob).not.toHaveBeenCalled();
    await tracker.refresh({ jobId: "j1", sessionId: "s1", runId: "r1" });
    expect(svc.getJob).toHaveBeenCalledTimes(1);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "treats the server id %s like any other job id end to end",
    async (id) => {
      tracker.track(job(id, "running", 1));
      expect(ownValue(state.jobs, id)!.job_id).toBe(id);
      svc.getJob.mockResolvedValueOnce(job(id, "running", 2));
      await advance(2000);
      expect(ownValue(state.jobs, id)!.revision).toBe(2);
      svc.cancelJob.mockResolvedValue({ snapshot: job(id, "cancelled", 3), pending: false });
      await tracker.cancel(id);
      expect(ownValue(state.jobs, id)!.state).toBe("cancelled");
      expect(onTerminal).toHaveBeenCalledTimes(1);
      expect(Object.getPrototypeOf(state.jobs)).toBeNull();
    }
  );
});

describe("cancel", () => {
  it("uses the latest revision, keeps a 202 non-terminal and polling", async () => {
    tracker.track(job("j1", "running", 4));
    svc.cancelJob.mockResolvedValue({ snapshot: job("j1", "cancel_requested", 5), pending: true });
    await tracker.cancel("j1");
    expect(svc.cancelJob).toHaveBeenCalledWith(
      { jobId: "j1", sessionId: "s1", runId: "r1", expectedRevision: 4 },
      { signal: expect.any(AbortSignal) }
    );
    expect(ownValue(state.jobs, "j1")!.state).toBe("cancel_requested");
    svc.getJob.mockResolvedValue(job("j1", "cancel_requested", 5));
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent cancels", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const both = Promise.all([tracker.cancel("j1"), tracker.cancel("j1")]);
    d.resolve({ snapshot: job("j1", "cancelled", 5), pending: false });
    await both;
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);
  });

  it.each<ArtifactAdapterErrorKind>([
    "invalid_request",
    "protocol",
    "network",
    "unavailable",
    "aborted",
    "integrity",
  ])("a %s cancel failure only sets lastError; the job stays tracked and polled", async (kind) => {
    tracker.track(job("j1", "running", 4));
    svc.cancelJob.mockRejectedValue(new ArtifactAdapterError(kind));
    await tracker.cancel("j1");
    expect(state.lastError).toBe(kind);
    expect(ownValue(state.jobs, "j1")).toBeDefined();
    svc.getJob.mockResolvedValue(job("j1", "running", 5));
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    await tracker.cancel("j1"); // may be retried by the user: marker released
    expect(svc.cancelJob).toHaveBeenCalledTimes(2);
  });

  it.each<ArtifactAdapterErrorKind>(["unauthorized", "not_found"])(
    "a %s cancel failure drops the tracked job and stops polling",
    async (kind) => {
      tracker.track(job("j1", "running", 4));
      svc.cancelJob.mockRejectedValue(new ArtifactAdapterError(kind));
      await tracker.cancel("j1");
      expect(state.lastError).toBe(kind);
      expect(ownValue(state.jobs, "j1")).toBeUndefined();
      await advance(10_000);
      expect(svc.getJob).not.toHaveBeenCalled();
    }
  );

  it("409 sets conflict, refetches once and never retries the cancel", async () => {
    tracker.track(job("j1", "running", 4));
    svc.cancelJob.mockRejectedValue(new ArtifactAdapterError("conflict", { status: 409 }));
    svc.getJob.mockResolvedValue(job("j1", "running", 7));
    await tracker.cancel("j1");
    await flush();
    expect(state.lastError).toBe("conflict");
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    expect(ownValue(state.jobs, "j1")!.revision).toBe(7);
    await advance(1);
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);
  });

  describe("deadline (hung cancel)", () => {
    type CancelResult = { snapshot: ImageJobSnapshot; pending: boolean };
    beforeEach(() => svc.getJob.mockResolvedValue(job("j1", "running", 4))); // polls stay healthy
    const hangCancel = () => {
      const d = defer<CancelResult>();
      const signals: AbortSignal[] = [];
      svc.cancelJob.mockImplementationOnce((_r: unknown, o: { signal: AbortSignal }) => {
        signals.push(o.signal);
        return d.promise; // ignores the abort
      });
      return { d, signals };
    };

    it("retires at the deadline: aborts, clears the marker, aborted lastError, job + polling kept", async () => {
      tracker.track(job("j1", "running", 4));
      const hung = hangCancel();
      let settled = false;
      void tracker.cancel("j1").then(() => (settled = true));
      await advance(19_999);
      expect(settled).toBe(false);
      expect(state.lastError).toBeUndefined();
      await advance(1);
      expect(hung.signals[0]!.aborted).toBe(true);
      expect(settled).toBe(true); // the caller is not left hanging on an abort-ignoring request
      expect(state.lastError).toBe("aborted");
      expect(ownValue(state.jobs, "j1")!.state).toBe("running");
      svc.getJob.mockResolvedValue(job("j1", "running", 5));
      await advance(2000);
      expect(svc.getJob).toHaveBeenCalled(); // polling alive
      svc.cancelJob.mockResolvedValueOnce({
        snapshot: job("j1", "cancel_requested", 6),
        pending: true,
      });
      await tracker.cancel("j1"); // dedupe slot is free again
      expect(svc.cancelJob).toHaveBeenCalledTimes(2);
      expect(ownValue(state.jobs, "j1")!.state).toBe("cancel_requested");
    });

    it("the retired call's late result/failure alters nothing and cannot free a newer attempt's slot", async () => {
      tracker.track(job("j1", "running", 4));
      const first = hangCancel();
      void tracker.cancel("j1");
      await advance(20_000);
      state.lastError = undefined;
      const second = hangCancel();
      void tracker.cancel("j1");
      await flush();
      expect(svc.cancelJob).toHaveBeenCalledTimes(2);
      first.d.resolve({ snapshot: job("j1", "cancelled", 9), pending: false });
      await flush();
      expect(ownValue(state.jobs, "j1")!.state).toBe("running");
      expect(onTerminal).not.toHaveBeenCalled();
      await tracker.cancel("j1"); // newer attempt still owns the marker: deduped
      expect(svc.cancelJob).toHaveBeenCalledTimes(2);
      expect(second.signals[0]!.aborted).toBe(false);
      second.d.reject(new ArtifactAdapterError("unauthorized")); // the live attempt IS honored
      await flush();
      expect(ownValue(state.jobs, "j1")).toBeUndefined();
      expect(state.lastError).toBe("unauthorized");
    });

    it("a retired call's late failure sets no lastError and cannot drop the job", async () => {
      tracker.track(job("j1", "running", 4));
      const hung = hangCancel();
      void tracker.cancel("j1");
      await advance(20_000);
      state.lastError = undefined;
      hung.d.reject(new ArtifactAdapterError("unauthorized"));
      await flush();
      expect(state.lastError).toBeUndefined();
      expect(ownValue(state.jobs, "j1")).toBeDefined();
    });

    it("session switch/release aborts the in-flight cancel and stops its deadline timer", async () => {
      tracker.track(job("j1", "running", 4));
      const hung = hangCancel();
      let settled = false;
      void tracker.cancel("j1").then(() => (settled = true));
      await flush();
      release();
      await flush();
      expect(hung.signals[0]!.aborted).toBe(true);
      expect(settled).toBe(true);
      expect(timers.size).toBe(0);
      hung.d.resolve({ snapshot: job("j1", "cancel_requested", 9), pending: true });
      await advance(120_000);
      expect(ownValue(state.jobs, "j1")).toBeUndefined();
      expect(state.lastError).toBeUndefined();
    });

    it("the marker is cleared synchronously at expiry (no microtask turn needed)", async () => {
      tracker.track(job("j1", "running", 4));
      hangCancel();
      void tracker.cancel("j1");
      await flush();
      [...timers.values()].find((t) => t.at === clock.t + 20_000)!.fn();
      svc.cancelJob.mockReturnValueOnce(new Promise(() => undefined));
      void tracker.cancel("j1"); // would be deduped if the marker lingered
      expect(svc.cancelJob).toHaveBeenCalledTimes(2);
    });

    it("a released attempt's cleanup cannot free the marker of a cancel started in the same tick", async () => {
      tracker.track(job("j1", "running", 4));
      hangCancel();
      void tracker.cancel("j1");
      await flush();
      release(); // session switch: aborts the first attempt, its `finally` is still queued
      tracker.track(job("j1", "running", 4));
      hangCancel();
      void tracker.cancel("j1"); // second attempt installs its marker before that `finally` runs
      await flush();
      await tracker.cancel("j1"); // must still be deduped
      expect(svc.cancelJob).toHaveBeenCalledTimes(2);
    });

    it("a retired call cannot resurrect a job dropped meanwhile, nor touch a re-tracked one", async () => {
      tracker.track(job("j1", "running", 4));
      const hung = hangCancel();
      void tracker.cancel("j1");
      await advance(20_000);
      svc.getJob.mockRejectedValueOnce(new ArtifactAdapterError("not_found"));
      await advance(2000);
      expect(ownValue(state.jobs, "j1")).toBeUndefined(); // poll dropped it
      hung.d.resolve({ snapshot: job("j1", "cancel_requested", 9), pending: true });
      await flush();
      expect(ownValue(state.jobs, "j1")).toBeUndefined();
      tracker.track(job("j1", "running", 1)); // same id, new entry
      hung.d.resolve({ snapshot: job("j1", "cancelled", 9), pending: false });
      await flush();
      expect(ownValue(state.jobs, "j1")!.state).toBe("running");
    });
  });

  it("a cancel success cannot resurrect a job that was dropped meanwhile", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const pending = tracker.cancel("j1");
    svc.getJob.mockRejectedValue(new ArtifactAdapterError("not_found"));
    await advance(2000); // poll gets not_found: tracking dropped
    expect(ownValue(state.jobs, "j1")).toBeUndefined();
    d.resolve({ snapshot: job("j1", "cancel_requested", 5), pending: true });
    await pending;
    expect(ownValue(state.jobs, "j1")).toBeUndefined();
    await advance(10_000);
    expect(svc.getJob).toHaveBeenCalledTimes(1); // no poll chain was restarted
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it("a stale cancel result is fenced by entry identity when the job was dropped and re-tracked", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValueOnce(d.promise);
    const stale = tracker.cancel("j1");
    svc.getJob.mockRejectedValueOnce(new ArtifactAdapterError("not_found"));
    await advance(2000); // dropped
    tracker.track(job("j1", "running", 1)); // fresh entry, same key, lower revision
    d.resolve({ snapshot: job("j1", "cancelled", 9), pending: false });
    await stale;
    expect(ownValue(state.jobs, "j1")!.state).toBe("running");
    expect(ownValue(state.jobs, "j1")!.revision).toBe(1);
    expect(onTerminal).not.toHaveBeenCalled();
    // the stale cancel must not block a cancel of the new entry
    svc.cancelJob.mockResolvedValueOnce({
      snapshot: job("j1", "cancel_requested", 2),
      pending: true,
    });
    await tracker.cancel("j1");
    expect(ownValue(state.jobs, "j1")!.state).toBe("cancel_requested");
  });

  it("a stale cancel FAILURE neither sets lastError nor drops the re-tracked entry", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValueOnce(d.promise);
    const stale = tracker.cancel("j1");
    svc.getJob.mockRejectedValueOnce(new ArtifactAdapterError("not_found"));
    await advance(2000);
    state.lastError = undefined;
    tracker.track(job("j1", "running", 1));
    d.reject(new ArtifactAdapterError("unauthorized"));
    await stale;
    expect(state.lastError).toBeUndefined();
    expect(ownValue(state.jobs, "j1")).toBeDefined();
  });

  it("a cancel that completes after the session was released installs nothing", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const pending = tracker.cancel("j1");
    release();
    state.active = "s2";
    d.resolve({ snapshot: job("j1", "cancelled", 5), pending: false });
    await pending;
    expect(Object.keys(state.jobs)).toEqual([]);
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it("a failing cancel after release leaves lastError alone", async () => {
    tracker.track(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const pending = tracker.cancel("j1");
    release();
    d.reject(new ArtifactAdapterError("network"));
    await pending;
    expect(state.lastError).toBeUndefined();
  });
});

describe("reset and deadline", () => {
  it("reset stops pollers, aborts in-flight runs and drops their late results", async () => {
    tracker.track(job("j1", "running", 1));
    const d = defer<ImageJobSnapshot>();
    let signal!: AbortSignal;
    svc.getJob.mockImplementation((_s: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return d.promise;
    });
    await advance(2000);
    release();
    expect(signal.aborted).toBe(true);
    d.resolve(job("j1", "succeeded", 3));
    await advance(60_000);
    expect(Object.keys(state.jobs)).toEqual([]);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    expect(onTerminal).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  it("retires a hung poll at the deadline: lastError aborted, chain continues, late result ignored", async () => {
    tracker.track(job("j1", "running", 1));
    const hung = defer<ImageJobSnapshot>();
    svc.getJob.mockReturnValueOnce(hung.promise); // ignores abort
    await advance(2000); // poll #1 starts
    expect(state.lastError).toBeUndefined();
    svc.getJob.mockResolvedValue(job("j1", "running", 2));
    await advance(20_000); // deadline retires #1; chain schedules the next poll
    expect(state.lastError).toBe("aborted");
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(2);
    expect(ownValue(state.jobs, "j1")!.revision).toBe(2);
    hung.resolve(job("j1", "succeeded", 9)); // abort-ignoring request lands very late
    await flush();
    expect(ownValue(state.jobs, "j1")!.revision).toBe(2);
    expect(onTerminal).not.toHaveBeenCalled();
  });
});
