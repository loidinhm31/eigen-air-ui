import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageArtifactRef, ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import {
  reinitServices,
  setArtifactService,
  setConfigService,
} from "../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
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
import { useReadinessStore } from "./readinessStore.js";

// --- deterministic harness: fake clock + manual timers + fake cache/services ---

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

const art = (id: string, run: string, over: Partial<ImageArtifactRef> = {}): ImageArtifactRef => ({
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
  ...over,
});

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

const artifactHint = (sessionId = "s1"): ImageHintSignal =>
  ({
    type: "event",
    version: "v1",
    event: "image_artifact.committed",
    session_id: sessionId,
    run_id: "r1",
    payload: { artifact_id: "a1", job_id: "j", ordinal: 0, state: "committed", revision: 3 },
  }) as unknown as ImageHintSignal;

const svc = {
  listAllArtifacts: vi.fn(),
  getJob: vi.fn(),
  cancelJob: vi.fn(),
};
const config = { getConfig: vi.fn(), getReadiness: vi.fn() };
const READERS = { image_artifacts: true, image_artifacts_version: "image_artifacts.v1" };
const GENERATION = { local_image: true, local_image_version: "local_image.v1" };
const store = () => useImageArtifactStore.getState();

async function ready(sessionId = "s1", caps: object = READERS) {
  config.getConfig.mockResolvedValue({ capabilities: caps });
  await store().refreshCapabilities();
  store().setActiveSession(sessionId);
}

beforeEach(() => {
  clock.t = 10_000;
  timers.clear();
  timerSeq = 0;
  for (const m of [
    svc.listAllArtifacts,
    svc.getJob,
    svc.cancelJob,
    config.getConfig,
    config.getReadiness,
  ])
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

describe("capabilities", () => {
  it("derives independent readers/generation gates from the gateway config", async () => {
    config.getConfig.mockResolvedValue({ capabilities: { ...READERS } });
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "known", readers: true, generation: false });

    config.getConfig.mockResolvedValue({ capabilities: { ...GENERATION } });
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "known", readers: false, generation: true });

    config.getConfig.mockResolvedValue({
      capabilities: { ...READERS, image_artifacts_version: "image_artifacts.v2" },
    });
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "known", readers: false, generation: false });

    config.getConfig.mockResolvedValue({});
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "known", readers: false, generation: false });
  });

  it("fails closed to unknown/false when the config read fails, even after a known value", async () => {
    config.getConfig.mockRejectedValue(new Error("boom with secret"));
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "unknown", readers: false, generation: false });

    config.getConfig.mockResolvedValue({ capabilities: { ...READERS, ...GENERATION } });
    await store().refreshCapabilities();
    expect(store().capabilities.generation).toBe(true);
    config.getConfig.mockRejectedValue(new Error("down"));
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "unknown", readers: false, generation: false });
  });

  it("is independent of chat provider readiness", async () => {
    useReadinessStore.setState({ canInfer: false });
    config.getConfig.mockResolvedValue({ capabilities: { ...READERS, ...GENERATION } });
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual({ status: "known", readers: true, generation: true });
    expect(config.getReadiness).not.toHaveBeenCalled();
  });

  it("shares one in-flight read and drops a result that lands after access invalidation", async () => {
    const d = defer<unknown>();
    config.getConfig.mockReturnValue(d.promise);
    const a = store().refreshCapabilities();
    const b = store().refreshCapabilities();
    expect(config.getConfig).toHaveBeenCalledTimes(1);
    reinitServices();
    d.resolve({ capabilities: { ...READERS } });
    await Promise.all([a, b]);
    expect(store().capabilities.status).toBe("unknown");
  });
});

describe("capabilities deadline (hung config read)", () => {
  const hangConfig = () => {
    const d = defer<unknown>();
    config.getConfig.mockImplementationOnce(() => d.promise); // takes no signal, may never settle
    return d;
  };
  const KNOWN_READERS = { status: "known", readers: true, generation: false };
  const UNKNOWN = { status: "unknown", readers: false, generation: false };

  it("retires a hung read at the deadline: unknown, share freed, a retry becomes known, the old response is inert", async () => {
    const hung = hangConfig();
    let settled = 0;
    void store()
      .refreshCapabilities()
      .then(() => settled++);
    void store()
      .refreshCapabilities()
      .then(() => settled++);
    expect(config.getConfig).toHaveBeenCalledTimes(1); // shared
    await advance(19_999);
    expect(settled).toBe(0);
    await advance(1);
    expect(settled).toBe(2); // sharers are released, not left hanging
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(timers.size).toBe(0);

    config.getConfig.mockResolvedValueOnce({ capabilities: { ...READERS } });
    await store().refreshCapabilities();
    expect(config.getConfig).toHaveBeenCalledTimes(2); // a NEW request, not the hung share
    expect(store().capabilities).toEqual(KNOWN_READERS);

    hung.resolve({ capabilities: { ...GENERATION } }); // would flip readers/generation if honored
    await flush();
    expect(store().capabilities).toEqual(KNOWN_READERS);
    expect(timers.size).toBe(0);
  });

  it("a retired response (late success or failure) cannot clobber a newer attempt in flight", async () => {
    const first = hangConfig();
    void store().refreshCapabilities();
    await advance(20_000);
    const second = hangConfig();
    let done = false;
    void store()
      .refreshCapabilities()
      .then(() => (done = true));
    await flush();
    expect(config.getConfig).toHaveBeenCalledTimes(2);

    first.resolve({ capabilities: { ...GENERATION } });
    await flush();
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(done).toBe(false); // the retired run did not settle the newer share
    void store().refreshCapabilities();
    expect(config.getConfig).toHaveBeenCalledTimes(2); // still joined to the newer attempt

    second.resolve({ capabilities: { ...READERS } });
    await flush();
    expect(done).toBe(true);
    expect(store().capabilities).toEqual(KNOWN_READERS);
  });

  it("a late FAILURE of the retired read does not turn a newer known value unknown", async () => {
    const hung = hangConfig();
    void store().refreshCapabilities();
    await advance(20_000);
    config.getConfig.mockResolvedValueOnce({ capabilities: { ...READERS } });
    await store().refreshCapabilities();
    hung.reject(new Error("socket reset"));
    await flush();
    expect(store().capabilities).toEqual(KNOWN_READERS);
  });

  it("a known value turns unknown when the refresh hangs (fail closed, like a failed read)", async () => {
    await ready();
    hangConfig();
    void store().refreshCapabilities();
    expect(store().capabilities.status).toBe("known");
    await advance(20_000);
    expect(store().capabilities).toEqual(UNKNOWN);
  });

  it("access invalidation after the hang discards both the retired and the retried response", async () => {
    const hung = hangConfig();
    void store().refreshCapabilities();
    await advance(20_000);
    const retry = hangConfig();
    void store().refreshCapabilities();
    await flush();
    const epoch = store().invalidationEpoch;
    reinitServices();
    expect(store().invalidationEpoch).toBe(epoch + 1);
    expect(timers.size).toBe(0); // the retried run's deadline timer is gone too

    hung.resolve({ capabilities: { ...READERS } });
    retry.resolve({ capabilities: { ...READERS } });
    await flush();
    expect(store().capabilities).toEqual(UNKNOWN);
  });

  it("a hung read that is invalidated before the deadline never installs and frees the share", async () => {
    const hung = hangConfig();
    const waiting = store().refreshCapabilities();
    reinitServices();
    await waiting; // released by the retirement
    expect(timers.size).toBe(0);
    setConfigService(config as unknown as IConfigService);
    config.getConfig.mockResolvedValueOnce({ capabilities: { ...READERS } });
    await store().refreshCapabilities();
    expect(store().capabilities).toEqual(KNOWN_READERS);
    hung.resolve({ capabilities: { ...GENERATION } });
    await flush();
    expect(store().capabilities).toEqual(KNOWN_READERS);
  });
});

describe("session listing", () => {
  it("is a no-op unless the session is active, and unavailable without readers", async () => {
    await ready("s1");
    await store().refreshSession("other");
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();

    config.getConfig.mockResolvedValue({ capabilities: GENERATION });
    await store().refreshCapabilities();
    await store().refreshSession("s1");
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
    expect(store().status).toBe("unavailable");
    expect(store().artifacts).toEqual([]);
  });

  it("installs a sorted listing, stamps with the pre-request cache clock and renews per run", async () => {
    await ready();
    const start = clock.t;
    svc.listAllArtifacts.mockImplementation(async () => {
      clock.t += 500; // response arrives later; the stamp must stay conservative
      return [
        art("b", "r2", { created_at_ms: 20 }),
        art("z", "r1", { created_at_ms: 10 }),
        art("a", "r1", { created_at_ms: 10 }),
        art("u", "r2", { created_at_ms: 30, state: "unavailable" }),
      ];
    });
    await store().refreshSession("s1");
    expect(svc.listAllArtifacts).toHaveBeenCalledWith(
      { sessionId: "s1" },
      { signal: expect.any(AbortSignal) }
    );
    expect(store().artifacts.map((x) => x.artifact_id)).toEqual(["a", "z", "b", "u"]);
    expect(store().status).toBe("ready");
    expect(store().listingStamps).toEqual({ r1: start, r2: start });
    expect(store().listingStampFor("s1", "r1")).toBe(start);
    expect(store().listingStampFor("other", "r1")).toBeUndefined();
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["a", "z"], start);
    expect(cache.renew).toHaveBeenCalledWith("s1", "r2", ["b"], start); // uncommitted never renewed
  });

  it("invalidates runs and artifacts that disappeared or stopped being committed", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValue([
      art("a", "r1"),
      art("b", "r1"),
      art("c", "r2"),
      art("d", "r3"),
    ]);
    await store().refreshSession("s1");
    cache.invalidateScope.mockClear();
    await advance(1000);
    svc.listAllArtifacts.mockResolvedValue([
      art("a", "r1"),
      art("b", "r1", { state: "deleted" }),
      art("d", "r3"),
    ]);
    await store().refreshSession("s1");
    expect(cache.invalidateScope).toHaveBeenCalledWith({
      sessionId: "s1",
      runId: "r1",
      artifactIds: ["b"],
    });
    expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1", runId: "r2" });
    expect(cache.invalidateScope).toHaveBeenCalledTimes(2);
    expect(store().listingStamps.r2).toBeUndefined();
  });

  it("session switch aborts the in-flight listing, bumps generation and drops late results", async () => {
    await ready("s1");
    const d = defer<ImageArtifactRef[]>();
    let signal!: AbortSignal;
    svc.listAllArtifacts.mockImplementationOnce((_q: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return d.promise;
    });
    const before = store().generation;
    const pending = store().refreshSession("s1");
    await flush();
    store().setActiveSession("s2");
    expect(signal.aborted).toBe(true);
    expect(store().generation).toBe(before + 1);
    expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1" });
    d.resolve([art("late", "r1")]);
    await pending;
    expect(store().artifacts).toEqual([]);
    expect(store().listingStamps).toEqual({});
    expect(store().activeSessionId).toBe("s2");
    expect(cache.renew).not.toHaveBeenCalled();
    await store().refreshSession("s1"); // old session is no longer active
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
  });

  it("clears artifacts, jobs and stamps on switch, and a same-session set is a no-op", async () => {
    await ready("s1");
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    store().trackJob(job("j1", "running", 1));
    const generation = store().generation;
    store().setActiveSession("s1");
    expect(store().generation).toBe(generation);
    expect(store().artifacts).toHaveLength(1);
    store().setActiveSession(null);
    expect(store().artifacts).toEqual([]);
    expect(store().jobs).toEqual({});
    expect(store().listingStamps).toEqual({});
    expect(store().status).toBe("idle");
  });

  it.each<[ArtifactAdapterErrorKind, string, boolean]>([
    ["unauthorized", "unavailable", true],
    ["not_found", "unavailable", true],
    ["page_cap", "error", true],
    ["protocol", "error", true],
    ["integrity", "error", true],
    ["network", "stale", false],
    ["unavailable", "stale", false],
    ["aborted", "stale", false],
  ])(
    "maps %s to %s (partial lists never survive fail-closed errors)",
    async (kind, status, failClosed) => {
      await ready();
      svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
      await store().refreshSession("s1");
      cache.renew.mockClear();
      cache.invalidateScope.mockClear();
      await advance(1000);
      svc.listAllArtifacts.mockRejectedValue(new ArtifactAdapterError(kind, { status: 500 }));
      await store().refreshSession("s1");
      expect(store().status).toBe(status);
      expect(store().lastError).toBe(kind);
      expect(JSON.stringify(store())).not.toContain("artifact_adapter_");
      expect(cache.renew).not.toHaveBeenCalled();
      if (failClosed) {
        expect(store().artifacts).toEqual([]);
        expect(store().listingStamps).toEqual({});
        expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1" });
      } else {
        expect(store().artifacts.map((x) => x.artifact_id)).toEqual(["a"]);
        expect(store().listingStamps.r1).toBeDefined();
      }
    }
  );

  it("a later successful listing clears lastError", async () => {
    await ready();
    svc.listAllArtifacts.mockRejectedValueOnce(new ArtifactAdapterError("network"));
    await store().refreshSession("s1");
    expect(store().lastError).toBe("network");
    await advance(1000);
    await store().refreshSession("s1");
    expect(store().lastError).toBeUndefined();
    expect(store().status).toBe("ready");
  });
});

describe("hint coalescing", () => {
  it("a burst of invalid hints runs one refresh now and exactly one trailing refresh >=1000 ms later", async () => {
    await ready();
    const starts: number[] = [];
    const lists: Array<Deferred<ImageArtifactRef[]>> = [];
    svc.listAllArtifacts.mockImplementation(() => {
      starts.push(clock.t);
      const d = defer<ImageArtifactRef[]>();
      lists.push(d);
      return d.promise;
    });
    for (let i = 0; i < 1000; i++) store().handleHint({ invalid: true });
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    lists[0]!.resolve([]);
    await flush();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1); // trailing waits for spacing
    await advance(999);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 1000; i++) store().handleHint({ invalid: true }); // while #2 is in flight
    lists[1]!.resolve([]);
    await advance(1000);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(3);
    lists[2]!.resolve([]);
    await advance(10_000);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1000);
  });

  it("ignores valid hints for other sessions and everything without an active session or readers", async () => {
    store().handleHint({ invalid: true });
    await ready("s1");
    store().handleHint(artifactHint("other"));
    store().handleHint(jobHint("j1", "other"));
    await flush();
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
    store().setActiveSession(null);
    store().handleHint(artifactHint("s1"));
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });

  it("hints never mutate artifacts or jobs; only the refetched listing does", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    const snapshot = { artifacts: store().artifacts, jobs: store().jobs };
    const d = defer<ImageArtifactRef[]>();
    await advance(1000);
    svc.listAllArtifacts.mockReturnValue(d.promise);
    store().handleHint(artifactHint());
    expect(store().artifacts).toBe(snapshot.artifacts);
    expect(store().jobs).toBe(snapshot.jobs);
    d.resolve([art("a", "r1"), art("b", "r1")]);
    await flush();
    expect(store().artifacts).toHaveLength(2);
  });

  it("handleHint never throws, whatever the signal or the services do", async () => {
    await ready();
    svc.listAllArtifacts.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const hostile = {
      get event(): string {
        throw new Error("getter boom");
      },
    };
    for (const signal of [
      null,
      undefined,
      7,
      {},
      { invalid: true },
      hostile,
      { event: "image_job.updated" },
    ]) {
      expect(() => store().handleHint(signal as never)).not.toThrow();
    }
    await flush();
    expect(store().status).toBe("error"); // sync throw from the service is a fail-closed listing error
  });
});

describe("run deadline (hung listing)", () => {
  const hang = () => {
    const d = defer<ImageArtifactRef[]>();
    let signal!: AbortSignal;
    svc.listAllArtifacts.mockImplementationOnce((_q: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return d.promise; // ignores the abort
    });
    return { d, signal: () => signal };
  };

  it("retires a hung first listing at 20 s: aborts, resolves waiters, goes stale/aborted", async () => {
    await ready();
    const hung = hang();
    let done = false;
    void store()
      .refreshSession("s1")
      .then(() => (done = true));
    await advance(19_999);
    expect(store().status).toBe("loading");
    expect(done).toBe(false);
    await advance(1);
    expect(hung.signal().aborted).toBe(true);
    expect(done).toBe(true);
    expect(store().status).toBe("stale");
    expect(store().lastError).toBe("aborted");
    expect(store().activeSessionId).toBe("s1");
  });

  it("hints refresh again after the retirement and the late result of the hung request never installs", async () => {
    await ready();
    const hung = hang();
    void store().refreshSession("s1");
    await advance(20_000);
    svc.listAllArtifacts.mockResolvedValue([art("fresh", "r1")]);
    store().handleHint(artifactHint());
    await flush();
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["fresh"]);
    expect(store().lastError).toBeUndefined();
    cache.renew.mockClear();
    hung.d.resolve([art("late", "r9")]);
    await flush();
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["fresh"]);
    expect(Object.keys(store().listingStamps)).toEqual(["r1"]);
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("a retired run's late completion/failure cannot clear, resolve or fail a newer run", async () => {
    await ready();
    const hung = hang();
    void store().refreshSession("s1");
    await advance(20_000);
    const second = defer<ImageArtifactRef[]>();
    svc.listAllArtifacts.mockReturnValueOnce(second.promise);
    let waited = false;
    void store()
      .refreshSession("s1")
      .then(() => (waited = true));
    await flush();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2); // run #2 in flight
    hung.d.reject(new ArtifactAdapterError("unauthorized")); // would wipe state if honored
    await flush();
    expect(store().status).not.toBe("unavailable");
    expect(waited).toBe(false);
    store().handleHint(artifactHint());
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2); // still one in flight + one trailing
    second.resolve([art("b", "r1")]);
    await flush();
    expect(waited).toBe(true);
    expect(store().artifacts.map((a) => a.artifact_id)).toEqual(["b"]);
    await advance(1000);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(3); // exactly one trailing run
  });
});

describe("session release (setActiveSession(null))", () => {
  it("is a no-op when nothing is active", () => {
    const generation = store().generation;
    store().setActiveSession(null);
    expect(store().generation).toBe(generation);
    expect(cache.invalidateScope).not.toHaveBeenCalled();
  });
  it("late results of released session A never touch a newer session B", async () => {
    await ready("s1");
    const a = defer<ImageArtifactRef[]>();
    svc.listAllArtifacts.mockReturnValueOnce(a.promise);
    const pendingA = store().refreshSession("s1");
    await flush();
    store().setActiveSession(null);
    store().setActiveSession("s2");
    svc.listAllArtifacts.mockResolvedValue([art("b1", "rb", { session_id: "s2" })]);
    await store().refreshSession("s2");
    a.resolve([art("a1", "ra")]);
    await pendingA;
    await flush();
    expect(store().artifacts.map((x) => x.artifact_id)).toEqual(["b1"]);
    expect(Object.keys(store().listingStamps)).toEqual(["rb"]);
    expect(cache.renew).not.toHaveBeenCalledWith("s1", "ra", expect.anything(), expect.anything());
  });

  it("re-activating the same session after release starts from a clean idle state", async () => {
    await ready("s1");
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    store().setActiveSession(null);
    store().setActiveSession("s1");
    expect(store().status).toBe("idle");
    expect(store().artifacts).toEqual([]);
    await advance(1000);
    await store().refreshSession("s1");
    expect(store().status).toBe("ready");
    expect(store().artifacts).toHaveLength(1);
  });
});

describe("prototype-safe lookups for server ids", () => {
  const NASTY = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  it("stamps, renews and looks up runs named like Object.prototype members", async () => {
    await ready();
    const start = clock.t;
    svc.listAllArtifacts.mockResolvedValue(NASTY.map((run, i) => art(`a${i}`, run)));
    await store().refreshSession("s1");
    expect(Object.keys(store().listingStamps).sort()).toEqual([...NASTY].sort());
    for (const [i, run] of NASTY.entries()) {
      expect(store().listingStampFor("s1", run)).toBe(start);
      expect(cache.renew).toHaveBeenCalledWith("s1", run, [`a${i}`], start);
    }
    expect(Object.getPrototypeOf(store().listingStamps)).toBeNull();
  });

  it("returns undefined, never an inherited value, for ids that are not stamped", async () => {
    await ready();
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    for (const run of NASTY) expect(store().listingStampFor("s1", run)).toBeUndefined();
    // state injected as a plain object by foreign code is guarded the same way
    useImageArtifactStore.setState({ listingStamps: { r1: 5 } });
    for (const run of NASTY) expect(store().listingStampFor("s1", run)).toBeUndefined();
    expect(store().listingStampFor("s1", "r1")).toBe(5);
  });
});

describe("auto-invalidation", () => {
  async function loaded() {
    await ready();
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    await store().refreshSession("s1");
    store().trackJob(job("j1", "running", 1));
    expect(store().artifacts).toHaveLength(1);
  }
  const expectInvalidated = (epoch: number) => {
    expect(store().artifacts).toEqual([]);
    expect(store().jobs).toEqual({});
    expect(store().listingStamps).toEqual({});
    expect(store().status).toBe("idle");
    expect(store().capabilities).toEqual({ status: "unknown", readers: false, generation: false });
    expect(store().activeSessionId).toBe("s1");
    expect(store().invalidationEpoch).toBe(epoch);
  };

  it("access invalidation clears state, resets capabilities and stops pollers/coalescer", async () => {
    await loaded();
    const d = defer<ImageArtifactRef[]>();
    await advance(1000);
    svc.listAllArtifacts.mockReturnValue(d.promise);
    store().handleHint({ invalid: true });
    reinitServices();
    expectInvalidated(1);
    d.resolve([art("late", "r1")]);
    await advance(20_000);
    expect(store().artifacts).toEqual([]);
    expect(svc.getJob).not.toHaveBeenCalled();
  });

  it("daemon URL change and leaving `connected` invalidate; connecting -> connected does not", async () => {
    await loaded();
    useConnectionStore.setState({ url: "http://d2" });
    expectInvalidated(1);

    await loaded();
    useConnectionStore.setState({ status: "disconnected" });
    expectInvalidated(2);

    useConnectionStore.setState({ status: "connected" }); // not leaving `connected`: no invalidation
    await loaded();
    useConnectionStore.setState({ status: "connecting" });
    expectInvalidated(3);
    await loaded();
    useConnectionStore.setState({ status: "connected" });
    expect(store().artifacts).toHaveLength(1);
    expect(store().invalidationEpoch).toBe(3);
  });

  it("dispose removes the subscriptions and cancels everything", async () => {
    await loaded();
    disposeImageArtifactStore();
    expect(store().activeSessionId).toBeNull();
    useImageArtifactStore.setState({ artifacts: [art("x", "r9")] });
    reinitServices();
    useConnectionStore.setState({ status: "disconnected" });
    expect(store().artifacts).toHaveLength(1);
  });
});
