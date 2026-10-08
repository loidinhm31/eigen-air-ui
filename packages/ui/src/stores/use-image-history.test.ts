// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ImageArtifactRef, ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import {
  reinitServices,
  setArtifactService,
  setChatService,
  setConfigService,
} from "../adapters/factory/ServiceFactory.js";
import type { IArtifactAdapter } from "../adapters/factory/interfaces/IArtifactAdapter.js";
import type {
  IChatService,
  ImageHintCallback,
} from "../adapters/factory/interfaces/IChatService.js";
import type { IConfigService } from "../adapters/factory/interfaces/IConfigService.js";
import {
  configureImageArtifactStore,
  disposeImageArtifactStore,
  useImageArtifactStore,
} from "./image-artifact-store.js";
import { useConnectionStore } from "./connectionStore.js";
import {
  useImageCapabilities,
  useImageHistorySync,
  useSessionImageGroups,
  useTrackedImageJobs,
} from "./use-image-history.js";

const clock = { t: 10_000 };
const timers = new Map<number, { at: number; fn: () => void }>();
let timerSeq = 0;
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function advance(ms: number) {
  const target = clock.t + ms;
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, v]) => v.at <= target)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    clock.t = Math.max(clock.t, due[1].at);
    await act(async () => {
      due[1].fn();
      await flush();
    });
  }
  clock.t = target;
  await act(flush);
}
const settle = () => act(flush);

const cache = {
  nowMs: () => clock.t,
  renew: vi.fn(() => 0),
  invalidateScope: vi.fn(() => ({ revoked: 0, cancelled: 0 })),
};
const svc = { listAllArtifacts: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn() };
const config = { getConfig: vi.fn() };
const READERS = { image_artifacts: true, image_artifacts_version: "image_artifacts.v1" };

interface FakeChat {
  service: IChatService;
  hint: { handler?: ImageHintCallback; off: Mock; on: Mock };
  reconnect: { handler?: () => void; off: Mock };
}
function fakeChat(): FakeChat {
  const fake: FakeChat = {
    hint: { off: vi.fn(), on: vi.fn() },
    reconnect: { off: vi.fn() },
    service: undefined as unknown as IChatService,
  };
  fake.service = {
    onImageHint: (handler: ImageHintCallback) => {
      fake.hint.handler = handler;
      fake.hint.on();
      return fake.hint.off;
    },
    onRunReconnect: (handler: () => void) => {
      fake.reconnect.handler = handler;
      return fake.reconnect.off;
    },
    disconnect: vi.fn(),
  } as unknown as IChatService;
  return fake;
}

const art = (id: string, run: string, over: Partial<ImageArtifactRef> = {}): ImageArtifactRef =>
  ({
    schema: "image_artifact.v1",
    artifact_id: id,
    job_id: `job-${run}`,
    session_id: "s1",
    run_id: run,
    ordinal: 0,
    state: "committed",
    created_at_ms: 1,
    ...over,
  }) as ImageArtifactRef;

let chat: FakeChat;
beforeEach(() => {
  clock.t = 10_000;
  timers.clear();
  timerSeq = 0;
  for (const m of [svc.listAllArtifacts, svc.getJob, svc.cancelJob, config.getConfig])
    m.mockReset();
  cache.invalidateScope.mockClear();
  svc.listAllArtifacts.mockResolvedValue([]);
  config.getConfig.mockResolvedValue({ capabilities: READERS });
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
  chat = fakeChat();
  setChatService(chat.service);
});
afterEach(() => {
  cleanup(); // vitest globals are off: RTL does not auto-unmount
  disposeImageArtifactStore();
});

describe("useImageHistorySync", () => {
  it("selects the session, fetches capabilities then the listing, and subscribes to hints/reconnect", async () => {
    const { unmount } = renderHook(() => useImageHistorySync("s1"));
    await settle();
    const state = useImageArtifactStore.getState();
    expect(state.activeSessionId).toBe("s1");
    expect(state.capabilities.readers).toBe(true);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(chat.hint.handler).toBeTypeOf("function");
    expect(chat.reconnect.handler).toBeTypeOf("function");

    unmount();
    expect(chat.hint.off).toHaveBeenCalledTimes(1);
    expect(chat.reconnect.off).toHaveBeenCalledTimes(1);
  });

  it("does not refetch capabilities that are already known", async () => {
    config.getConfig.mockResolvedValue({ capabilities: READERS });
    await useImageArtifactStore.getState().refreshCapabilities();
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    expect(config.getConfig).toHaveBeenCalledTimes(1);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
  });

  it("delivers WS hints to the store (coalesced refetch), including invalid ones", async () => {
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    await advance(1000);
    act(() => chat.hint.handler!({ invalid: true }));
    await settle();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
  });

  it("session change swaps subscriptions, drops the old listing and fetches the new session", async () => {
    const { rerender } = renderHook(({ id }) => useImageHistorySync(id), {
      initialProps: { id: "s1" as string | null },
    });
    await settle();
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1", { session_id: "s2" })]);
    rerender({ id: "s2" });
    await settle();
    expect(chat.hint.off).toHaveBeenCalledTimes(1);
    expect(chat.hint.on).toHaveBeenCalledTimes(2);
    const state = useImageArtifactStore.getState();
    expect(state.activeSessionId).toBe("s2");
    expect(svc.listAllArtifacts).toHaveBeenLastCalledWith({ sessionId: "s2" }, expect.anything());
    expect(state.artifacts.map((a) => a.artifact_id)).toEqual(["a"]);
    expect(cache.invalidateScope).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("a null session selects nothing, fetches nothing and subscribes to nothing", async () => {
    renderHook(() => useImageHistorySync(null));
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBeNull();
    expect(config.getConfig).not.toHaveBeenCalled();
    expect(chat.hint.on).not.toHaveBeenCalled();
  });

  it("reconnect refetches capabilities first, then the session listing", async () => {
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    await advance(1000);
    let release!: () => void;
    config.getConfig.mockReturnValue(
      new Promise((res) => (release = () => res({ capabilities: READERS })))
    );
    act(() => chat.reconnect.handler!());
    await settle();
    expect(config.getConfig).toHaveBeenCalledTimes(2);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1); // waits for capabilities
    release();
    await settle();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
  });

  it("re-subscribes to the re-created chat service and refetches after access invalidation", async () => {
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    const next = fakeChat();
    setChatService(next.service);
    act(() => reinitServices());
    await settle();
    expect(chat.hint.off).toHaveBeenCalledTimes(1);
    expect(next.hint.on).toHaveBeenCalledTimes(1);
    expect(useImageArtifactStore.getState().capabilities.status).toBe("known"); // refetched
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
  });

  it("still loads history when no chat service exists yet", async () => {
    setChatService(null as never);
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
  });
});

const job = (id: string, state: ImageJobSnapshot["state"], revision: number): ImageJobSnapshot =>
  ({
    schema: "image_job.v1",
    job_id: id,
    session_id: "s1",
    run_id: "r1",
    state,
    revision,
    created_at_ms: 1,
  }) as unknown as ImageJobSnapshot;

describe("useImageHistorySync connection gating (capability retry)", () => {
  const setStatus = (status: "disconnected" | "connecting" | "connected") =>
    act(() => useConnectionStore.setState({ status }));

  it("fetches nothing while disconnected, then capabilities + listing on the first `connected`", async () => {
    useConnectionStore.setState({ status: "disconnected" });
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s1"); // selected, not fetched
    expect(config.getConfig).not.toHaveBeenCalled();
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
    expect(chat.hint.on).not.toHaveBeenCalled();
    expect(chat.reconnect.handler).toBeUndefined();

    setStatus("connecting");
    await settle();
    expect(config.getConfig).not.toHaveBeenCalled();

    setStatus("connected");
    await settle();
    expect(config.getConfig).toHaveBeenCalledTimes(1);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(useImageArtifactStore.getState().capabilities.status).toBe("known");
    expect(useImageArtifactStore.getState().status).toBe("ready");
    expect(chat.hint.on).toHaveBeenCalledTimes(1);
  });

  it("retries failed capabilities on the next `connected` and then lists", async () => {
    config.getConfig.mockRejectedValueOnce(new Error("pre-connect failure"));
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    let state = useImageArtifactStore.getState();
    expect(state.capabilities).toEqual({ status: "unknown", readers: false, generation: false });
    expect(state.status).toBe("unavailable");
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();

    setStatus("connecting");
    setStatus("connected");
    await settle();
    state = useImageArtifactStore.getState();
    expect(config.getConfig).toHaveBeenCalledTimes(2);
    expect(state.capabilities.status).toBe("known");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("ready");
  });

  it("failed retries keep capabilities unknown and the session unavailable (no manufactured support)", async () => {
    config.getConfig.mockRejectedValue(new Error("still failing"));
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    setStatus("connecting");
    setStatus("connected");
    await settle();
    const state = useImageArtifactStore.getState();
    expect(config.getConfig).toHaveBeenCalledTimes(2);
    expect(state.capabilities).toEqual({ status: "unknown", readers: false, generation: false });
    expect(state.status).toBe("unavailable");
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });

  it("capability denial fetches no listing and exposes no stamps/artifacts", async () => {
    config.getConfig.mockResolvedValue({ capabilities: {} });
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    const state = useImageArtifactStore.getState();
    expect(state.capabilities).toEqual({ status: "known", readers: false, generation: false });
    expect(state.status).toBe("unavailable");
    expect(state.artifacts).toEqual([]);
    expect(state.listingStampFor("s1", "r1")).toBeUndefined();
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });

  it("does not refetch in a loop: one fetch per connection transition", async () => {
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    await advance(5000);
    expect(config.getConfig).toHaveBeenCalledTimes(1);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    setStatus("connecting"); // invalidation: caps unknown, list cleared, not connected -> idle
    await settle();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    setStatus("connected");
    await settle();
    await advance(5000);
    expect(config.getConfig).toHaveBeenCalledTimes(2);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
  });
});

// The package has no Node typings; vitest runs in Node, where `process` exists.
declare const process: {
  on(event: "unhandledRejection", handler: (reason: unknown) => void): void;
  off(event: "unhandledRejection", handler: (reason: unknown) => void): void;
};

describe("useImageHistorySync: explicit refresh recovers lost capabilities (same mounted lifecycle)", () => {
  const store = () => useImageArtifactStore.getState();
  const UNKNOWN = { status: "unknown", readers: false, generation: false };
  const ids = () => store().artifacts.map((a) => a.artifact_id);
  const explicitRefresh = () => act(async () => store().refreshSession("s1"));
  const hangNextRead = () => {
    let release!: (value: unknown) => void;
    config.getConfig.mockReturnValueOnce(new Promise((res) => (release = res)));
    return (value: unknown) => release(value);
  };

  async function mountLoaded() {
    svc.listAllArtifacts.mockResolvedValue([art("a1", "r1")]);
    const view = renderHook(({ id }) => useImageHistorySync(id), {
      initialProps: { id: "s1" as string | null },
    });
    await settle();
    expect(ids()).toEqual(["a1"]);
    return view;
  }
  /** A reconnect's forced capability read fails: fail closed, history dropped, nothing listed. */
  async function capsFailedByReconnect() {
    await advance(1000);
    config.getConfig.mockRejectedValueOnce(new Error("down"));
    act(() => chat.reconnect.handler!());
    await settle();
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(store().status).toBe("unavailable");
    expect(ids()).toEqual([]);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
  }

  it("1: failed refresh drops history; ONE explicit refreshSession re-reads capabilities and restores it (no reconnect/remount)", async () => {
    await mountLoaded();
    const before = [store().generation, store().invalidationEpoch, chat.hint.on.mock.calls.length];
    await capsFailedByReconnect();
    await advance(1000);
    svc.listAllArtifacts.mockResolvedValue([art("a1", "r1"), art("a2", "r2")]);
    cache.renew.mockClear();
    await explicitRefresh();
    expect(config.getConfig).toHaveBeenCalledTimes(3); // mount, failed reconnect read, recovery
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(store().capabilities).toMatchObject({ status: "known", readers: true });
    expect(store().status).toBe("ready");
    expect(ids()).toEqual(["a1", "a2"]);
    expect(store().listingStampFor("s1", "r2")).toBe(clock.t);
    expect(cache.renew).toHaveBeenCalledWith("s1", "r1", ["a1"], clock.t);
    // Same lifecycle: no resubscribe, no invalidation, no session switch.
    const after = [store().generation, store().invalidationEpoch, chat.hint.on.mock.calls.length];
    expect(after).toEqual(before);
    expect(chat.hint.off).not.toHaveBeenCalled();
  });

  it("2: hung reconnect read: deadline drops history; ONE new read recovers; the late original (conflicting) changes nothing", async () => {
    await mountLoaded();
    await advance(1000);
    const releaseHung = hangNextRead();
    act(() => chat.reconnect.handler!());
    await advance(20_000);
    expect(store().capabilities).toEqual(UNKNOWN);
    expect(ids()).toEqual([]);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);

    await explicitRefresh();
    expect(config.getConfig).toHaveBeenCalledTimes(3); // mount, hung, ONE new read
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(["a1"]);

    cache.renew.mockClear();
    releaseHung({ capabilities: {} }); // would turn readers off if honored
    await settle();
    expect(store().capabilities).toMatchObject({ status: "known", readers: true });
    expect(store().status).toBe("ready");
    expect(ids()).toEqual(["a1"]);
    expect(cache.renew).not.toHaveBeenCalled();
    await advance(60_000); // no automatic retry / request storm
    expect(config.getConfig).toHaveBeenCalledTimes(3);
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
  });

  it("3: recovery that reports no readers keeps history unavailable: no listing, no stamps, no renew", async () => {
    const caps = renderHook(() => useImageCapabilities());
    await mountLoaded();
    await capsFailedByReconnect();
    cache.renew.mockClear();
    config.getConfig.mockResolvedValueOnce({ capabilities: {} });
    await advance(1000);
    await explicitRefresh();
    expect(caps.result.current).toEqual({ status: "known", readers: false, generation: false });
    expect(store().status).toBe("unavailable");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual([]);
    expect(store().listingStampFor("s1", "r1")).toBeUndefined(); // old authorization is gone
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("4a: session switch while the recovery read is pending: s1 is never listed or renewed", async () => {
    const view = await mountLoaded();
    await capsFailedByReconnect();
    cache.renew.mockClear();
    svc.listAllArtifacts.mockResolvedValue([]);
    const release = hangNextRead();
    act(() => void store().refreshSession("s1"));
    await settle();
    view.rerender({ id: "s2" });
    await settle();
    release({ capabilities: READERS });
    await settle();
    const listed = svc.listAllArtifacts.mock.calls.map(([req]) => req.sessionId);
    expect(listed).toEqual(["s1", "s2"]); // only the initial s1 listing and s2's own refresh
    expect(store().activeSessionId).toBe("s2");
    expect(ids()).toEqual([]);
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("4b: access epoch change while the recovery read is pending: the old response installs nowhere", async () => {
    await mountLoaded();
    await capsFailedByReconnect();
    cache.renew.mockClear();
    const release = hangNextRead();
    act(() => void store().refreshSession("s1"));
    await settle();
    act(() => reinitServices()); // epoch +1: effect re-runs with its own fresh read + listing
    await settle();
    expect(config.getConfig).toHaveBeenCalledTimes(4); // mount, failed, pending (retired), fresh
    expect(ids()).toEqual(["a1"]);
    cache.renew.mockClear();
    release({ capabilities: {} }); // retired response, conflicting
    await settle();
    expect(store().capabilities).toMatchObject({ status: "known", readers: true });
    expect(store().status).toBe("ready");
    expect(ids()).toEqual(["a1"]);
    expect(cache.renew).not.toHaveBeenCalled();
  });

  it("5: a throwing store subscriber makes neither the hook nor refreshCapabilities reject (no unhandled rejection)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const off = useImageArtifactStore.subscribe((s, prev) => {
      if (s.capabilities !== prev.capabilities) throw new Error("subscriber failure");
    });
    try {
      renderHook(() => useImageHistorySync("s1"));
      await settle();
      await expect(store().refreshCapabilities()).resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 0)); // let node surface unhandled rejections
    } finally {
      off();
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(store().capabilities).toEqual(UNKNOWN); // fail closed, never the throwing install's value
    expect(store().status).toBe("unavailable");
  });
});

describe("useImageHistorySync consumer refcount / deactivation", () => {
  const ownedJob = async () => {
    await act(async () => useImageArtifactStore.getState().trackJob(job("j1", "running", 1)));
    svc.getJob.mockResolvedValue(job("j1", "running", 2));
  };

  it("unmounting one of several same-session consumers keeps the session; the last one deactivates and stops polling", async () => {
    const first = renderHook(() => useImageHistorySync("s1"));
    const second = renderHook(() => useImageHistorySync("s1"));
    await settle();
    await ownedJob();

    first.unmount();
    await advance(2000);
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s1");
    expect(svc.getJob).toHaveBeenCalledTimes(1); // still polling for the remaining consumer

    second.unmount();
    svc.getJob.mockClear();
    svc.listAllArtifacts.mockClear();
    await advance(30_000);
    const state = useImageArtifactStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.artifacts).toEqual([]);
    expect(state.jobs).toEqual({});
    expect(state.listingStamps).toEqual({});
    expect(state.status).toBe("idle");
    expect(svc.getJob).not.toHaveBeenCalled();
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  it("a hung cancel is aborted by the last unmount and its late delivery changes nothing", async () => {
    const view = renderHook(() => useImageHistorySync("s1"));
    await settle();
    await ownedJob();
    let signal!: AbortSignal;
    let deliver!: (value: unknown) => void;
    svc.cancelJob.mockImplementationOnce((_r: unknown, o: { signal: AbortSignal }) => {
      signal = o.signal;
      return new Promise((resolve) => void (deliver = resolve)); // ignores the abort
    });
    const cancelling = useImageArtifactStore.getState().cancelJob("j1");
    await settle();
    expect(signal.aborted).toBe(false);

    view.unmount();
    await cancelling; // released, not left hanging
    expect(signal.aborted).toBe(true);
    expect(timers.size).toBe(0);

    svc.listAllArtifacts.mockClear();
    deliver({ snapshot: job("j1", "cancelled", 9), pending: false });
    await advance(30_000);
    const state = useImageArtifactStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.jobs).toEqual({});
    expect(state.lastError).toBeUndefined();
    expect(svc.listAllArtifacts).not.toHaveBeenCalled();
  });

  it("switching sessions keeps the new session active (stale cleanup of A never stops B)", async () => {
    const { rerender } = renderHook(({ id }) => useImageHistorySync(id), {
      initialProps: { id: "s1" as string | null },
    });
    await settle();
    rerender({ id: "s2" });
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s2");
    expect(svc.listAllArtifacts).toHaveBeenLastCalledWith({ sessionId: "s2" }, expect.anything());
    expect(useImageArtifactStore.getState().status).toBe("ready");
  });

  it("a stale unmount of session A does not deactivate the newer session B", async () => {
    const a = renderHook(() => useImageHistorySync("s1"));
    await settle();
    const b = renderHook(() => useImageHistorySync("s2"));
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s2");

    a.unmount();
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s2");
    expect(useImageArtifactStore.getState().status).toBe("ready");

    b.unmount();
    expect(useImageArtifactStore.getState().activeSessionId).toBeNull();
  });

  it("mounting with null never steals another consumer's session; the owner's unmount releases it", async () => {
    const owner = renderHook(() => useImageHistorySync("s1"));
    renderHook(() => useImageHistorySync(null));
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s1");
    owner.unmount();
    expect(useImageArtifactStore.getState().activeSessionId).toBeNull();
  });

  it("survives StrictMode effect cleanup + re-setup (session stays active and is listed once)", async () => {
    renderHook(() => useImageHistorySync("s1"), { wrapper: StrictMode });
    await settle();
    expect(useImageArtifactStore.getState().activeSessionId).toBe("s1");
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(useImageArtifactStore.getState().status).toBe("ready");
  });

  it("remounting after a full release refetches the listing (capabilities stay known)", async () => {
    svc.listAllArtifacts.mockResolvedValue([art("a", "r1")]);
    const first = renderHook(() => useImageHistorySync("s1"));
    await settle();
    expect(useImageArtifactStore.getState().artifacts).toHaveLength(1);
    first.unmount();
    expect(useImageArtifactStore.getState().artifacts).toEqual([]);

    await advance(1000);
    renderHook(() => useImageHistorySync("s1"));
    await settle();
    expect(svc.listAllArtifacts).toHaveBeenCalledTimes(2);
    expect(config.getConfig).toHaveBeenCalledTimes(1);
    expect(useImageArtifactStore.getState().artifacts).toHaveLength(1);
  });
});

describe("selector hooks", () => {
  it("useImageCapabilities follows the store", async () => {
    const { result } = renderHook(() => useImageCapabilities());
    expect(result.current.status).toBe("unknown");
    await act(() => useImageArtifactStore.getState().refreshCapabilities());
    expect(result.current).toEqual({ status: "known", readers: true, generation: false });
  });

  it("useSessionImageGroups binds by exact run_id, memoizes, and recomputes on artifact change", async () => {
    useImageArtifactStore.setState({
      artifacts: [art("a", "r1"), art("b", "r2", { created_at_ms: 2 })],
    });
    const messages = [
      { role: "user", run_id: "r1" },
      { role: "assistant", run_id: "r1" },
    ];
    const { result, rerender } = renderHook(({ m }) => useSessionImageGroups(m), {
      initialProps: { m: messages },
    });
    expect([...result.current.bound.keys()]).toEqual([1]);
    expect(result.current.unbound.map((g) => g.runId)).toEqual(["r2"]);
    const first = result.current;
    rerender({ m: messages });
    expect(result.current).toBe(first);

    act(() => useImageArtifactStore.setState({ artifacts: [art("a", "r1")] }));
    expect(result.current).not.toBe(first);
    expect(result.current.unbound).toEqual([]);
  });

  it("useTrackedImageJobs lists tracked jobs oldest first and is referentially stable", () => {
    const job = (id: string, created: number) =>
      ({ job_id: id, created_at_ms: created }) as ImageJobSnapshot;
    useImageArtifactStore.setState({ jobs: { b: job("b", 20), a: job("a", 10), c: job("c", 20) } });
    const { result, rerender } = renderHook(() => useTrackedImageJobs());
    expect(result.current.map((j) => j.job_id)).toEqual(["a", "b", "c"]);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
