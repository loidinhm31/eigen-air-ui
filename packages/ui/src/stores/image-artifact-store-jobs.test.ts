import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageArtifactRef, ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import {
  reinitServices,
  setArtifactService,
  setConfigService,
} from "../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type IArtifactAdapter,
} from "../adapters/factory/interfaces/IArtifactAdapter.js";
import type { IConfigService } from "../adapters/factory/interfaces/IConfigService.js";
import type { ImageHintSignal } from "../adapters/factory/interfaces/IChatService.js";
import {
  configureImageArtifactStore,
  disposeImageArtifactStore,
  useImageArtifactStore,
} from "./image-artifact-store.js";
import { useConnectionStore } from "./connectionStore.js";

// Store-level job behavior (tracking, polling, cancel, release) plus listing-run lifecycle (retire,
// retry after a failed/hung first listing, capability recovery by an explicit refreshSession).
// Tracker internals (entry tokens, fences, deadline) live in image-job-tracker.test.ts.

const clock = { t: 10_000 };
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

const cache = {
  nowMs: () => clock.t,
  invalidateScope: vi.fn(() => ({ revoked: 0, cancelled: 0 })),
  renew: vi.fn<(sessionId: string, runId: string, ids: Iterable<string>, at?: number) => number>(
    () => 0
  ),
};

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

const art = (id: string, run: string): ImageArtifactRef =>
  ({
    schema: "image_artifact.v1",
    artifact_id: id,
    job_id: `job-${run}`,
    session_id: "s1",
    run_id: run,
    ordinal: 0,
    mime: "image/png",
    width: 256,
    height: 256,
    byte_size: 100,
    sha256: "a".repeat(64),
    created_at_ms: 1,
    state: "committed",
  }) as ImageArtifactRef;

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

const jobHint = (jobId: string, sessionId = "s1"): ImageHintSignal =>
  ({
    type: "event",
    version: "v1",
    event: "image_job.updated",
    session_id: sessionId,
    run_id: "r1",
    payload: { job_id: jobId, session_id: sessionId, run_id: "r1", state: "running", revision: 2 },
  }) as unknown as ImageHintSignal;

const artifactHint = (): ImageHintSignal =>
  ({
    type: "event",
    version: "v1",
    event: "image_artifact.committed",
    session_id: "s1",
    run_id: "r1",
    payload: { artifact_id: "a1", job_id: "j", ordinal: 0, state: "committed", revision: 3 },
  }) as unknown as ImageHintSignal;

const svc = { listAllArtifacts: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn() };
const config = { getConfig: vi.fn() };
const READERS = { image_artifacts: true, image_artifacts_version: "image_artifacts.v1" };
const store = () => useImageArtifactStore.getState();

async function ready(sessionId = "s1") {
  config.getConfig.mockResolvedValue({ capabilities: READERS });
  await store().refreshCapabilities();
  store().setActiveSession(sessionId);
}

beforeEach(() => {
  clock.t = 10_000;
  timers.clear();
  timerSeq = 0;
  for (const m of [svc.listAllArtifacts, svc.getJob, svc.cancelJob, config.getConfig])
    m.mockReset();
  cache.renew.mockClear();
  cache.invalidateScope.mockClear();
  svc.listAllArtifacts.mockResolvedValue([]);
  useConnectionStore.setState({ url: "http://d1", status: "connected" });
  disposeImageArtifactStore();
  configureImageArtifactStore({
    now: () => clock.t,
    setTimer: (fn, ms) => {
      const id = ++timerSeq;
      timers.set(id, { at: clock.t + ms, fn });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    cache: () => cache,
  });
  setArtifactService(svc as unknown as IArtifactAdapter);
  setConfigService(config as unknown as IConfigService);
});
afterEach(() => disposeImageArtifactStore());

describe("jobs", () => {
  it("tracks only jobs of the active session and polls every 2000 ms until terminal, then relists once", async () => {
    await ready();
    store().trackJob(job("foreign", "running", 1, { session_id: "other" }));
    expect(store().jobs).toEqual({});
    store().trackJob(job("j1", "running", 1));
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
    expect(store().jobs.j1!.revision).toBe(2);
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
    await advance(2000);
    expect(store().jobs.j1!.state).toBe("succeeded");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    await advance(20_000);
    expect(svc.getJob).toHaveBeenCalledTimes(2);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
  });

  it("a stale (lower revision) snapshot never overwrites a newer one", async () => {
    await ready();
    store().trackJob(job("j1", "running", 5));
    store().trackJob(job("j1", "admitted", 2));
    expect(store().jobs.j1!.revision).toBe(5);
  });

  it("cancel uses the latest revision, treats 202 as requested (never killed) and keeps polling", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    svc.cancelJob.mockResolvedValue({ snapshot: job("j1", "cancel_requested", 5), pending: true });
    await store().cancelJob("j1");
    expect(svc.cancelJob).toHaveBeenCalledWith(
      { jobId: "j1", sessionId: "s1", runId: "r1", expectedRevision: 4 },
      { signal: expect.any(AbortSignal) }
    );
    expect(store().jobs.j1!.state).toBe("cancel_requested");
    svc.getJob
      .mockResolvedValueOnce(job("j1", "cancel_requested", 5))
      .mockResolvedValueOnce(job("j1", "cancelled", 6));
    await advance(2000);
    expect(store().jobs.j1!.state).toBe("cancel_requested");
    await advance(2000);
    expect(store().jobs.j1!.state).toBe("cancelled");
    expect(svc.getJob).toHaveBeenCalledTimes(2);
  });

  it("stores a terminal 200/202 snapshot verbatim, stops polling and relists", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    svc.cancelJob.mockResolvedValue({ snapshot: job("j1", "cancelled", 5), pending: false });
    await store().cancelJob("j1");
    expect(store().jobs.j1!.state).toBe("cancelled");
    await advance(10_000);
    expect(svc.getJob).not.toHaveBeenCalled();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    await store().cancelJob("j1"); // terminal: nothing to cancel
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);
  });

  it("409 refetches the job once and never retries the cancel automatically", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    svc.cancelJob.mockRejectedValue(new ArtifactAdapterError("conflict", { status: 409 }));
    svc.getJob.mockResolvedValue(job("j1", "running", 7));
    await store().cancelJob("j1");
    await flush();
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    expect(store().jobs.j1!.revision).toBe(7);
    expect(store().lastError).toBe("conflict");
    await advance(1);
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent cancels and surfaces other errors as a kind only", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const first = store().cancelJob("j1");
    const second = store().cancelJob("j1");
    d.reject(new ArtifactAdapterError("unavailable"));
    await Promise.all([first, second]);
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);
    expect(store().lastError).toBe("unavailable");
    expect(store().jobs.j1).toBeDefined(); // transient: still tracked, still polled
  });

  it("a protocol/invalid cancel failure keeps the live job tracked; only denial drops it", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    store().trackJob(job("j2", "running", 4));
    svc.cancelJob.mockImplementation(async ({ jobId }: { jobId: string }) => {
      throw new ArtifactAdapterError(jobId === "j1" ? "protocol" : "not_found");
    });
    await store().cancelJob("j1");
    expect(store().lastError).toBe("protocol");
    expect(store().jobs.j1).toBeDefined();
    await store().cancelJob("j2");
    expect(store().lastError).toBe("not_found");
    expect(store().jobs.j2).toBeUndefined();
    svc.getJob.mockResolvedValue(job("j1", "running", 5));
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(1); // only j1 still polled
  });

  it("a cancel result cannot resurrect a job whose tracking was dropped meanwhile", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    const d = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(d.promise);
    const pending = store().cancelJob("j1");
    svc.getJob.mockRejectedValue(new ArtifactAdapterError("not_found"));
    await advance(2000);
    expect(store().jobs.j1).toBeUndefined();
    d.resolve({ snapshot: job("j1", "cancel_requested", 5), pending: true });
    await pending;
    expect(store().jobs.j1).toBeUndefined();
    await advance(20_000);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
  });

  it("drops a job on denial or protocol failure but keeps it on transient poll errors", async () => {
    await ready();
    store().trackJob(job("j1", "running", 1));
    store().trackJob(job("j2", "running", 1));
    svc.getJob.mockImplementation(async ({ jobId }: { jobId: string }) => {
      throw new ArtifactAdapterError(jobId === "j1" ? "not_found" : "network");
    });
    await advance(2000);
    expect(store().jobs.j1).toBeUndefined();
    expect(store().jobs.j2).toBeDefined();
    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(3); // j2 keeps polling, j1 stopped
  });

  it("a job hint refetches only tracked non-terminal jobs, coalesced per job", async () => {
    await ready();
    store().trackJob(job("j1", "running", 1));
    store().trackJob(job("done", "succeeded", 9));
    svc.getJob.mockResolvedValue(job("j1", "running", 2));
    store().handleHint(jobHint("untracked"));
    store().handleHint(jobHint("done"));
    expect(svc.getJob).not.toHaveBeenCalled();
    for (let i = 0; i < 50; i++) store().handleHint(jobHint("j1"));
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    await advance(0);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(svc.getJob).toHaveBeenCalledTimes(2);
  });

  it("session switch cancels pollers and fences in-flight job results", async () => {
    await ready("s1");
    store().trackJob(job("j1", "running", 1));
    const d = defer<ImageJobSnapshot>();
    svc.getJob.mockReturnValue(d.promise);
    await advance(2000);
    store().setActiveSession("s2");
    d.resolve(job("j1", "succeeded", 3));
    await advance(20_000);
    expect(store().jobs).toEqual({});
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });
});

describe("prototype-safe job ids", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "tracks, hints, polls and cancels the server id %s like any other id",
    async (id) => {
      await ready();
      store().handleHint(jobHint(id)); // untracked: must not crash or fetch the job
      await flush();
      expect(svc.getJob).not.toHaveBeenCalled();
      store().trackJob(job(id, "running", 1));
      expect(Object.keys(store().jobs)).toEqual([id]);
      svc.getJob.mockResolvedValue(job(id, "running", 2));
      await advance(2000);
      expect(Object.keys(store().jobs)).toEqual([id]);
      expect(Object.getOwnPropertyDescriptor(store().jobs, id)!.value.revision).toBe(2);
      svc.cancelJob.mockResolvedValue({ snapshot: job(id, "cancelled", 3), pending: false });
      await store().cancelJob(id);
      expect(Object.getOwnPropertyDescriptor(store().jobs, id)!.value.state).toBe("cancelled");
      expect(Object.getPrototypeOf(store().jobs)).toBeNull();
    }
  );

  it("inherited members are never reported as tracked jobs", async () => {
    await ready();
    store().trackJob(job("j1", "running", 1));
    for (const id of ["__proto__", "constructor", "toString"]) {
      await store().cancelJob(id);
      await store().refreshJob({ jobId: id, sessionId: "s1", runId: "r1" });
    }
    expect(svc.cancelJob).not.toHaveBeenCalled();
    expect(svc.getJob).not.toHaveBeenCalled();
  });
});

describe("session release (setActiveSession(null))", () => {
  it("stops all work, drops session memory and fences every late result", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    store().trackJob(job("polled", "running", 1));
    store().trackJob(job("cancelled", "running", 1));
    const poll = defer<ImageJobSnapshot>();
    const signals: AbortSignal[] = [];
    svc.getJob.mockImplementation((_s: unknown, o: { signal: AbortSignal }) => {
      signals.push(o.signal);
      return poll.promise;
    });
    const cancel = defer<{ snapshot: ImageJobSnapshot; pending: boolean }>();
    svc.cancelJob.mockReturnValue(cancel.promise);
    const cancelling = store().cancelJob("cancelled");
    await advance(2000); // both pollers fire: getJob in flight
    const relist = defer<ImageArtifactRef[]>();
    svc.listAllArtifacts.mockReturnValueOnce(relist.promise);
    let waiter = false;
    void store()
      .refreshSession("s1")
      .then(() => (waiter = true));
    await flush();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    store().handleHint(artifactHint()); // trailing
    cache.invalidateScope.mockClear();
    cache.renew.mockClear();
    const generation = store().generation;
    const calls = {
      list: svc.listAllArtifacts.mock.calls.length,
      job: svc.getJob.mock.calls.length,
    };

    store().setActiveSession(null);

    expect(store().activeSessionId).toBeNull();
    expect(store().generation).toBe(generation + 1);
    expect(store().status).toBe("idle");
    expect(store().artifacts).toEqual([]);
    expect(Object.keys(store().jobs)).toEqual([]);
    expect(Object.keys(store().listingStamps)).toEqual([]);
    expect(store().lastError).toBeUndefined();
    expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(timers.size).toBe(0); // pollers, spacing and deadline timers all gone
    await flush();
    expect(waiter).toBe(true); // waiters resolved, never left hanging

    relist.resolve([art("late", "r1")]);
    poll.resolve(job("polled", "succeeded", 9));
    cancel.reject(new ArtifactAdapterError("not_found"));
    await cancelling;
    await advance(120_000);
    expect(store().artifacts).toEqual([]);
    expect(Object.keys(store().jobs)).toEqual([]);
    expect(store().lastError).toBeUndefined();
    expect(cache.renew).not.toHaveBeenCalled();
    expect(svc.listAllArtifacts.mock.calls.length).toBe(calls.list); // no trailing, no relist
    expect(svc.getJob.mock.calls.length).toBe(calls.job);
    // inactive: hints, refreshes and tracking are ignored
    store().handleHint(artifactHint());
    await store().refreshSession("s1");
    store().trackJob(job("polled", "running", 1));
    expect(svc.listAllArtifacts.mock.calls.length).toBe(calls.list);
    expect(Object.keys(store().jobs)).toEqual([]);
  });

  it("a poll that lands after release and re-activation of the same session is dropped", async () => {
    await ready();
    store().trackJob(job("j1", "running", 1));
    const d = defer<ImageJobSnapshot>();
    svc.getJob.mockReturnValue(d.promise);
    await advance(2000);
    store().setActiveSession(null);
    store().setActiveSession("s1");
    d.resolve(job("j1", "succeeded", 3));
    await advance(30_000);
    expect(Object.keys(store().jobs)).toEqual([]);
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });
});

describe("hung cancel (store level)", () => {
  type CancelResult = { snapshot: ImageJobSnapshot; pending: boolean };
  const hangCancel = () => {
    const d = defer<CancelResult>();
    let signal!: AbortSignal;
    svc.cancelJob.mockImplementationOnce((_r: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return d.promise; // ignores the abort
    });
    return { d, signal: () => signal };
  };

  it("polling and listing stay alive while it hangs; the deadline frees a retry; a late result is inert", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    const hung = hangCancel();
    void store().cancelJob("j1");
    svc.getJob.mockResolvedValue(job("j1", "running", 5));
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);

    await advance(2000);
    expect(svc.getJob).toHaveBeenCalledTimes(1);
    expect(store().jobs.j1!.revision).toBe(5);
    await store().refreshSession("s1");
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["a"]);
    await store().cancelJob("j1"); // deduped while the first call is still in its window
    expect(svc.cancelJob).toHaveBeenCalledTimes(1);

    await advance(18_000); // 20 s after the cancel started
    expect(hung.signal().aborted).toBe(true);
    expect(store().lastError).toBe("aborted");
    expect(store().jobs.j1).toBeDefined();

    svc.cancelJob.mockResolvedValueOnce({
      snapshot: job("j1", "cancel_requested", 6),
      pending: true,
    });
    await store().cancelJob("j1");
    expect(svc.cancelJob).toHaveBeenCalledTimes(2);
    expect(store().jobs.j1!.state).toBe("cancel_requested");

    hung.d.resolve({ snapshot: job("j1", "running", 3), pending: true });
    await flush();
    expect(store().jobs.j1!.state).toBe("cancel_requested"); // retired result cannot regress it
    expect(svc.getJob).toHaveBeenCalled(); // poll chain never stopped
  });

  it("late delivery after a session switch changes neither the new session nor lastError", async () => {
    await ready();
    store().trackJob(job("j1", "running", 4));
    const hung = hangCancel();
    const cancelling = store().cancelJob("j1");
    await flush();
    store().setActiveSession("s2");
    expect(hung.signal().aborted).toBe(true); // the session fence aborts the in-flight call
    await cancelling;
    expect(timers.size).toBe(0);

    svc.listAllArtifacts.mockClear();
    hung.d.resolve({ snapshot: job("j1", "cancelled", 9), pending: false });
    await advance(120_000);
    expect(store().activeSessionId).toBe("s2");
    expect(Object.keys(store().jobs)).toEqual([]);
    expect(store().lastError).toBeUndefined();
    expect(svc.listAllArtifacts).not.toHaveBeenCalledWith({ sessionId: "s1" }, expect.anything());
    expect(store().artifacts).toEqual([]);
  });
});

describe("retireInFlightListing / resetListingStamps", () => {
  const hold = () => {
    const d = defer<ImageArtifactRef[]>();
    let signal!: AbortSignal;
    svc.listAllArtifacts.mockImplementationOnce((_q: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return d.promise; // ignores the abort
    });
    return { d, signal: () => signal };
  };
  const ids = () => store().artifacts.map((a) => a.artifact_id);

  it("retires the in-flight run WITHOUT clearing artifacts; its late response installs and renews nothing", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValueOnce([art("keep", "r1")]);
    await store().refreshSession("s1");
    await advance(1000);
    const held = hold();
    let waited = false;
    void store()
      .refreshSession("s1")
      .then(() => (waited = true));
    await flush();
    cache.renew.mockClear();
    cache.invalidateScope.mockClear();

    store().retireInFlightListing();
    await flush();
    expect(held.signal().aborted).toBe(true);
    expect(waited).toBe(true);
    expect(timers.size).toBe(0);
    expect(ids()).toEqual(["keep"]);
    expect(store().status).toBe("ready");

    held.d.resolve([art("late", "r9")]);
    await flush();
    expect(ids()).toEqual(["keep"]);
    expect(Object.keys(store().listingStamps)).toEqual(["r1"]);
    expect(cache.renew).not.toHaveBeenCalled();
    expect(cache.invalidateScope).not.toHaveBeenCalled();

    // The spacing clock is reset: a fresh listing starts at once and re-stamps.
    svc.listAllArtifacts.mockResolvedValueOnce([art("fresh", "r1")]);
    await store().refreshSession("s1");
    expect(ids()).toEqual(["fresh"]);
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["fresh"], clock.t);
  });

  it("drops the trailing request; a pure `loading` state returns to idle; no active run is a no-op", async () => {
    await ready();
    hold();
    void store().refreshSession("s1");
    await flush();
    expect(store().status).toBe("loading");
    store().handleHint(artifactHint()); // trailing
    store().retireInFlightListing();
    expect(store().status).toBe("idle");
    expect(store().activeSessionId).toBe("s1");
    await advance(5000);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1); // no trailing run survived

    store().retireInFlightListing(); // nothing in flight
    expect(store().status).toBe("idle");
    store().setActiveSession(null);
    store().retireInFlightListing();
    expect(store().activeSessionId).toBeNull();
  });

  it("resetListingStamps drops only the stamps", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValueOnce([art("a", "r1")]);
    await store().refreshSession("s1");
    expect(store().listingStampFor("s1", "r1")).toBe(clock.t);
    store().resetListingStamps();
    expect(store().listingStampFor("s1", "r1")).toBeUndefined();
    expect(ids()).toEqual(["a"]);
    expect(store().status).toBe("ready");
  });
});

describe("explicit refreshSession after a failed or hung FIRST listing", () => {
  it("hung first listing: stale + empty, then an explicit retry installs the artifacts; the old response never renews", async () => {
    await ready();
    const d = defer<ImageArtifactRef[]>();
    svc.listAllArtifacts.mockReturnValueOnce(d.promise);
    void store().refreshSession("s1");
    await advance(20_000);
    expect(store().status).toBe("stale");
    expect(store().artifacts).toEqual([]);
    expect(cache.renew).not.toHaveBeenCalled();

    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1"), art("a2", "r1")]);
    await store().refreshSession("s1");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(store().status).toBe("ready");
    expect(store().lastError).toBeUndefined();
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["a1", "a2"]);
    expect(cache.renew).toHaveBeenCalledTimes(1);
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["a1", "a2"], clock.t);

    cache.renew.mockClear();
    d.resolve([art("old", "r9")]);
    await flush();
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["a1", "a2"]);
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("failed first listing: stale, no partial list, no renew; the explicit retry recovers", async () => {
    await ready();
    svc.listAllArtifacts.mockRejectedValueOnce(new ArtifactAdapterError("network"));
    await store().refreshSession("s1");
    expect(store().status).toBe("stale");
    expect(store().lastError).toBe("network");
    expect(store().artifacts).toEqual([]);
    expect(Object.keys(store().listingStamps)).toEqual([]);
    expect(cache.renew).not.toHaveBeenCalled();

    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1")]);
    const retry = store().refreshSession("s1"); // waits out the 1 s start spacing
    await advance(1000);
    await retry;
    expect(store().status).toBe("ready");
    expect(store().lastError).toBeUndefined();
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["a1"]);
    expect(cache.renew).toHaveBeenCalledTimes(1);
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["a1"], clock.t);
  });
});

describe("explicit refreshSession recovers lost capabilities (same session, no reconnect)", () => {
  const UNKNOWN = { status: "unknown", readers: false, generation: false };
  const ids = () => store().artifacts.map((a) => a.artifact_id);
  const hangConfig = () => {
    const d = defer<unknown>();
    config.getConfig.mockImplementationOnce(() => d.promise);
    return d;
  };
  /** Loaded history (a1), then a failed capability refresh: fail closed, wiped. */
  async function loadedThenCapsFailed() {
    await ready();
    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1")]);
    await store().refreshSession("s1");
    expect(ids()).toEqual(["a1"]);
    config.getConfig.mockRejectedValueOnce(new Error("down"));
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(store().status).toBe("unavailable");
    expect(ids()).toEqual([]);
    expect(Object.keys(store().listingStamps)).toEqual([]);
    expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1" });
  }

  it("1: one explicit refresh = one NEW capability read, then a complete listing restores history with a fresh stamp", async () => {
    await loadedThenCapsFailed();
    const before = [store().generation, store().invalidationEpoch, store().activeSessionId];
    cache.renew.mockClear();
    await advance(1000);
    config.getConfig.mockResolvedValueOnce({ capabilities: READERS });
    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1"), art("a2", "r2")]);
    await store().refreshSession("s1");
    expect(config.getConfig).toHaveBeenCalledTimes(3); // ready, failed refresh, recovery
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(store().capabilities).toMatchObject({ status: "known", readers: true });
    expect(store().status).toBe("ready");
    expect(ids()).toEqual(["a1", "a2"]);
    expect(store().listingStampFor("s1", "r1")).toBe(clock.t); // new request-time anchor
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["a1"], clock.t);
    const after = store(); // no reconnect, no session switch, no invalidation
    expect([after.generation, after.invalidationEpoch, after.activeSessionId]).toEqual(before);
  });

  it("2: hung capability reads: refreshes during a hang join it; after the deadline ONE new read recovers; late originals change nothing", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1")]);
    await store().refreshSession("s1");
    const hung1 = hangConfig();
    void store().refreshCapabilities();
    await advance(20_000); // known -> unknown at the deadline: history dropped (fail closed)
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(store().status).toBe("unavailable");
    expect(ids()).toEqual([]);

    const hung2 = hangConfig(); // the explicit refreshes below start this one and share it
    const during = [store().refreshSession("s1"), store().refreshSession("s1")];
    await flush();
    expect(config.getConfig).toHaveBeenCalledTimes(3); // ready, hung1, hung2: no storm
    await advance(21_000); // deadline, then the start spacing of the joined refreshes
    await Promise.all(during);
    expect(store().status).toBe("unavailable");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1); // joined refreshes list nothing

    config.getConfig.mockResolvedValueOnce({ capabilities: READERS });
    svc.listAllArtifacts.mockResolvedValueOnce([art("a1", "r1")]);
    const recover = Promise.all([store().refreshSession("s1"), store().refreshCapabilities()]);
    await advance(1000); // start spacing after the previous (no-op) run
    await recover;
    expect(config.getConfig).toHaveBeenCalledTimes(4); // exactly one NEW read for both
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(store().status).toBe("ready");

    cache.renew.mockClear();
    hung1.resolve({ capabilities: {} }); // conflicting late answers: readers off
    hung2.resolve({ capabilities: {} });
    await flush();
    expect(store().capabilities).toMatchObject({ status: "known", readers: true });
    expect(store().status).toBe("ready");
    expect(ids()).toEqual(["a1"]);
    expect(cache.renew).not.toHaveBeenCalled();
    await advance(60_000);
    expect(config.getConfig).toHaveBeenCalledTimes(4);
    expect(timers.size).toBe(0);
  });

  it("3: a recovery that fails again, or reports no readers, keeps history unavailable: no listing, no stamps, no renew", async () => {
    await loadedThenCapsFailed();
    cache.renew.mockClear();
    config.getConfig.mockRejectedValueOnce(new Error("still down"));
    await store().refreshSession("s1");
    expect(store().capabilities).toEqual(UNKNOWN);
    config.getConfig.mockResolvedValueOnce({ capabilities: {} });
    const second = store().refreshSession("s1");
    await advance(1000); // start spacing after the previous (no-op) run
    await second;
    expect(config.getConfig).toHaveBeenCalledTimes(4); // one new read per explicit refresh
    expect(store().capabilities).toEqual({ status: "known", readers: false, generation: false });
    expect(store().status).toBe("unavailable");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual([]);
    expect(store().listingStampFor("s1", "r1")).toBeUndefined(); // old authorization is gone
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("4a: session switch while the recovery read is pending: the old session lists/renews nothing", async () => {
    await loadedThenCapsFailed();
    cache.renew.mockClear();
    const pending = defer<unknown>();
    config.getConfig.mockReturnValueOnce(pending.promise);
    const refresh = store().refreshSession("s1");
    await flush();
    store().setActiveSession("s2");
    pending.resolve({ capabilities: READERS });
    await refresh;
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1); // no s1 listing after the switch
    expect(cache.renew).not.toHaveBeenCalled();
    expect(store().activeSessionId).toBe("s2");
    expect(store().status).toBe("idle");
  });

  it("4b: access epoch change while the recovery read is pending: the old response installs nowhere", async () => {
    await loadedThenCapsFailed();
    cache.renew.mockClear();
    const pending = defer<unknown>();
    config.getConfig.mockReturnValueOnce(pending.promise);
    const refresh = store().refreshSession("s1");
    await flush();
    const epoch = store().invalidationEpoch;
    reinitServices();
    expect(store().invalidationEpoch).toBe(epoch + 1);
    pending.resolve({ capabilities: READERS });
    await refresh;
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(cache.renew).not.toHaveBeenCalled();
    expect(store().status).toBe("idle"); // dropped refresh: no `unavailable` flash after invalidation
  });

  it("5: a throwing store subscriber cannot make refreshCapabilities reject; capabilities end fail-closed", async () => {
    config.getConfig.mockResolvedValue({ capabilities: READERS });
    const off = useImageArtifactStore.subscribe(() => {
      throw new Error("subscriber failure");
    });
    try {
      await expect(store().refreshCapabilities()).resolves.toBeUndefined();
    } finally {
      off();
    }
    expect(store().capabilities).toEqual(UNKNOWN);
  });
});
