// @vitest-environment jsdom
/**
 * Foreground lease driver: <=15 s expiry/refresh ticks, resume ordering/spacing, suspend guard,
 * ref-counted teardown, and the REAL store -> REAL cache renewal chain.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import { ArtifactAdapterError } from "../adapters/factory/interfaces/IArtifactAdapter.js";
import { getArtifactBlobCache } from "./artifact-blob-cache.js";
import { useImageArtifactStore } from "./image-artifact-store.js";
import {
  configureImageLeaseDriver,
  disposeImageLeaseDriver,
  IMAGE_LEASE_DRIVER_INTERVAL_MS,
  IMAGE_LEASE_SUSPEND_GAP_MS,
  registerImagePreview,
} from "./image-lease-driver.js";
import { isLeaseUsable, loadImagePreview } from "./image-preview-loader.js";
import {
  codeOf,
  enableRealImageStore,
  installImagePreviewFakes,
  makeArtifact,
  stampListing,
} from "./image-preview-test-support.js";

const fakes = installImagePreviewFakes();

const setVisibility = (state: "hidden" | "visible") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
afterEach(() => setVisibility("visible"));

describe("lease driver ticks", () => {
  it("expires stale URLs every <= 15 s and lists once per visible tick", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    const off = registerImagePreview("s1");
    const expire = vi.spyOn(getArtifactBlobCache(), "expireStale");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
    expect(fakes.refresh).toHaveBeenLastCalledWith("s1");
    expect(lease.revoked).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000); // t=30 s: the t=0 listing's lease is over
    expect(expire).toHaveBeenCalledTimes(2);
    expect(fakes.refresh).toHaveBeenCalledTimes(2);
    expect(lease.revoked).toBe(true);
    expect(fakes.revoked).toEqual(["blob:fake/1"]);
    off();
  });

  it("clamps an injected interval to 15 s and accepts a shorter one", async () => {
    useImageArtifactStore.setState({ activeSessionId: "s1" });
    configureImageLeaseDriver({ intervalMs: 1_000_000 });
    const slow = registerImagePreview("s1");
    await vi.advanceTimersByTimeAsync(IMAGE_LEASE_DRIVER_INTERVAL_MS - 1);
    expect(fakes.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
    slow();

    fakes.refresh.mockClear();
    configureImageLeaseDriver({ intervalMs: 1_000 });
    const fast = registerImagePreview("s1");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fakes.refresh).toHaveBeenCalledTimes(3);
    fast();
  });

  it("does not list when no registered preview belongs to the active session", async () => {
    useImageArtifactStore.setState({ activeSessionId: "other" });
    const off = registerImagePreview("s1");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fakes.refresh).not.toHaveBeenCalled();
    off();
  });

  it("keeps expiring on every tick even when a listing never settles", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    fakes.refresh.mockImplementation(() => new Promise(() => undefined));
    const off = registerImagePreview("s1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fakes.refresh).toHaveBeenCalledTimes(2);
    expect(lease.revoked).toBe(true);
    off();
  });
});

describe("lease driver lifetime", () => {
  it("is ref-counted: interval and listeners go away only with the last registration", async () => {
    useImageArtifactStore.setState({ activeSessionId: "s1" });
    const first = registerImagePreview("s1");
    const second = registerImagePreview("s1");
    expect(vi.getTimerCount()).toBe(1);

    first();
    first(); // idempotent: must not release the second registration
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);

    second();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
  });

  it("an unregister that outlives dispose is inert and never starves a later registration", async () => {
    useImageArtifactStore.setState({ activeSessionId: "s1" });
    const outdated = registerImagePreview("s1");
    disposeImageLeaseDriver();
    expect(vi.getTimerCount()).toBe(0);
    outdated();

    const off = registerImagePreview("s1");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fakes.refresh).toHaveBeenCalledTimes(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no work when nothing is registered", async () => {
    useImageArtifactStore.setState({ activeSessionId: "s1" });
    const expire = vi.spyOn(getArtifactBlobCache(), "expireStale");
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event("focus"));
    expect(expire).not.toHaveBeenCalled();
    expect(fakes.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("hidden document and resume", () => {
  it("skips network ticks while hidden but keeps expiring", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    setVisibility("hidden");
    const off = registerImagePreview("s1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fakes.refresh).not.toHaveBeenCalled();
    expect(lease.revoked).toBe(true);
    off();
  });

  it("visibility->visible and focus revoke expired URLs BEFORE refreshing, in that order", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    // Throttled tab: time passes while no driver runs, so the expired URL is still mapped.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(lease.revoked).toBe(false);

    setVisibility("hidden");
    const off = registerImagePreview("s1");
    const order: string[] = [];
    const cache = getArtifactBlobCache();
    const realExpire = cache.expireStale.bind(cache);
    vi.spyOn(cache, "expireStale").mockImplementation(() => {
      const revokedNow = realExpire();
      order.push(`expire:${revokedNow}:revoked=${fakes.revoked.length}`);
      return revokedNow;
    });
    fakes.refresh.mockImplementation(async () => {
      order.push(`refresh:revoked=${fakes.revoked.length}`);
    });

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(order).toEqual(["expire:1:revoked=1", "refresh:revoked=1"]);
    expect(lease.revoked).toBe(true);

    order.length = 0;
    window.dispatchEvent(new Event("focus"));
    expect(order).toEqual(["expire:0:revoked=1", "refresh:revoked=1"]);
    off();
  });

  it("becoming hidden only expires, no listing", () => {
    useImageArtifactStore.setState({ activeSessionId: "s1" });
    const expire = vi.spyOn(getArtifactBlobCache(), "expireStale");
    const off = registerImagePreview("s1");
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(expire).toHaveBeenCalledTimes(1);
    expect(fakes.refresh).not.toHaveBeenCalled();
    off();
  });
});

describe("suspend guard (wall clock vs lease clock)", () => {
  const resumers = {
    tick: () => vi.advanceTimersByTimeAsync(IMAGE_LEASE_DRIVER_INTERVAL_MS),
    focus: async () => void window.dispatchEvent(new Event("focus")),
    visibility: async () => void document.dispatchEvent(new Event("visibilitychange")),
  };

  it.each(Object.keys(resumers) as Array<keyof typeof resumers>)(
    "a suspend gap seen on %s invalidates every preview BEFORE expire/refresh",
    async (via) => {
      let skewMs = 0;
      configureImageLeaseDriver({ wallClock: () => Date.now() + skewMs });
      stampListing();
      const lease = await loadImagePreview(makeArtifact("a1"));
      const off = registerImagePreview("s1");

      const cache = getArtifactBlobCache();
      const order: string[] = [];
      const realInvalidate = cache.invalidateAll.bind(cache);
      vi.spyOn(cache, "invalidateAll").mockImplementation(() => {
        realInvalidate();
        order.push(`invalidate:revoked=${fakes.revoked.length}`);
      });
      const realExpire = cache.expireStale.bind(cache);
      vi.spyOn(cache, "expireStale").mockImplementation(() => {
        order.push("expire");
        return realExpire();
      });
      fakes.refresh.mockImplementation(async () => void order.push("refresh"));

      skewMs = 120_000; // the OS slept: wall clock moved, the lease clock did not
      await resumers[via]();
      expect(order.slice(0, 3)).toEqual(["invalidate:revoked=1", "expire", "refresh"]);
      expect(order.filter((step) => step.startsWith("invalidate"))).toHaveLength(1);
      expect(lease.revoked).toBe(true);
      expect(isLeaseUsable(lease)).toBe(false);
      // The pre-sleep stamp is gone: loading again must re-authorize via a fresh listing first.
      expect(useImageArtifactStore.getState().listingStampFor("s1", "r1")).toBeUndefined();
      fakes.refresh.mockClear();
      fakes.fetchBytes.mockClear();
      expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe("authorization_stale");
      expect(fakes.refresh).toHaveBeenCalledWith("s1");
      expect(fakes.fetchBytes).not.toHaveBeenCalled();
      off();
    }
  );

  it("treats only a gap strictly above 2 s as suspension, and measures between checkpoints", async () => {
    let skewMs = 0;
    configureImageLeaseDriver({ wallClock: () => Date.now() + skewMs });
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    const off = registerImagePreview("s1");
    const invalidate = vi.spyOn(getArtifactBlobCache(), "invalidateAll");

    skewMs = IMAGE_LEASE_SUSPEND_GAP_MS; // exactly 2 s: jitter, not a suspension
    window.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
    expect(lease.revoked).toBe(false);

    window.dispatchEvent(new Event("focus")); // baseline moved: no gap left
    expect(invalidate).not.toHaveBeenCalled();

    skewMs += IMAGE_LEASE_SUSPEND_GAP_MS + 1; // a fresh 2.001 s gap since the last checkpoint
    window.dispatchEvent(new Event("focus"));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(lease.revoked).toBe(true);
    window.dispatchEvent(new Event("focus")); // already handled
    expect(invalidate).toHaveBeenCalledTimes(1);
    off();
  });

  it("ordinary time passing on both clocks (throttled/hidden tab) never invalidates", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    const off = registerImagePreview("s1");
    const invalidate = vi.spyOn(getArtifactBlobCache(), "invalidateAll");
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
    expect(lease.revoked).toBe(false);
    off();
  });
});

describe("REAL store -> REAL cache lease renewal", () => {
  const listed = (ids: string[]): ImageArtifactRef[] => ids.map((id) => makeArtifact(id));
  const network = () => new ArtifactAdapterError("network");

  it("renews only from an authorizing listing, anchored to that request's captured stamp", async () => {
    await vi.advanceTimersByTimeAsync(5_000); // park the clock away from the epoch
    enableRealImageStore("s1");
    const cache = getArtifactBlobCache();
    const store = useImageArtifactStore.getState();
    const renew = vi.spyOn(cache, "renew");
    fakes.listAll.mockResolvedValue(listed(["a1"]));

    await store.refreshSession("s1"); // listing at t0
    const t0 = cache.nowMs();
    expect(renew).toHaveBeenCalledWith("s1", "r1", ["a1"], t0);
    renew.mockClear();
    const lease = await loadImagePreview(makeArtifact("a1"));
    expect(lease.url).toBe("blob:fake/1");

    await vi.advanceTimersByTimeAsync(10_000); // t0+10 s: cache hit never extends
    const hit = await loadImagePreview(makeArtifact("a1"));
    expect(hit.url).toBe(lease.url);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
    hit.release();

    await vi.advanceTimersByTimeAsync(10_000); // t0+20 s: a failed listing never renews
    fakes.listAll.mockRejectedValueOnce(network());
    await store.refreshSession("s1");
    expect(useImageArtifactStore.getState().status).toBe("stale");
    expect(renew).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000); // t0+25 s: request starts, answer lands at +27 s
    let answer: (items: ImageArtifactRef[]) => void = () => undefined;
    fakes.listAll.mockImplementationOnce(
      () => new Promise<ImageArtifactRef[]>((resolve) => void (answer = resolve))
    );
    const pending = store.refreshSession("s1");
    await vi.advanceTimersByTimeAsync(2_000);
    answer(listed(["a1"]));
    await pending;
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith("s1", "r1", ["a1"], t0 + 25_000);

    await vi.advanceTimersByTimeAsync(3_001); // t0+30.001 s: past the ORIGINAL expiry
    expect(isLeaseUsable(lease)).toBe(true);
    expect(cache.expireStale()).toBe(0);
    await vi.advanceTimersByTimeAsync(24_998); // t0+54.999 s: renewed anchor (25 s) + 29.999 s
    expect(isLeaseUsable(lease)).toBe(true);
    await vi.advanceTimersByTimeAsync(1); // t0+55 s: anchor + 30 s
    expect(isLeaseUsable(lease)).toBe(false);
    expect(cache.expireStale()).toBe(1);
    expect(fakes.revoked).toEqual(["blob:fake/1"]);
    expect(lease.revoked).toBe(true);
  });

  it("explicit resume refresh: expireStale runs synchronously, the listing waits out the 1 s spacing, no lease extension", async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    enableRealImageStore("s1");
    const cache = getArtifactBlobCache();
    fakes.listAll.mockResolvedValue(listed(["a1"]));
    await useImageArtifactStore.getState().refreshSession("s1");
    const t0 = cache.nowMs();
    const lease = await loadImagePreview(makeArtifact("a1"));
    const off = registerImagePreview("s1"); // ticks at t0+15 s and t0+30 s
    const renew = vi.spyOn(cache, "renew");
    const expire = vi.spyOn(cache, "expireStale");
    fakes.listAll.mockClear();
    fakes.listAll.mockRejectedValue(network()); // every later listing fails: never renews

    await vi.advanceTimersByTimeAsync(14_500); // t0+14.5 s: a hint starts a listing
    useImageArtifactStore.getState().handleHint({ invalid: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.listAll).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200); // t0+14.7 s: focus resume inside the spacing window
    expire.mockClear();
    window.dispatchEvent(new Event("focus"));
    expect(expire).toHaveBeenCalledTimes(1); // synchronous, before any refresh
    expect(fakes.listAll).toHaveBeenCalledTimes(1); // listing deferred, not started

    await vi.advanceTimersByTimeAsync(799); // t0+15.499 s (the t0+15 s tick merged into the trailing run)
    expect(fakes.listAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // t0+15.5 s: 1000 ms after the hint listing started
    expect(fakes.listAll).toHaveBeenCalledTimes(2);

    expect(renew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_498); // t0+29.998 s
    expect(isLeaseUsable(lease)).toBe(true);
    await vi.advanceTimersByTimeAsync(2); // t0+30 s tick: lease anchored at t0 ends
    expect(lease.revoked).toBe(true);
    expect(cache.nowMs() - t0).toBe(30_000);
    off();
  });

  describe("suspend gap with a listing held across the sleep", () => {
    /** A `listAllArtifacts` call the test answers manually; ignores the abort like a stuck socket. */
    const hold = () => {
      let answer!: (items: ImageArtifactRef[]) => void;
      let signal!: AbortSignal;
      fakes.listAll.mockImplementationOnce((_query, options) => {
        const requestOptions = options as { signal: AbortSignal }; // the store always passes one
        signal = requestOptions.signal;
        return new Promise<ImageArtifactRef[]>((resolve) => void (answer = resolve));
      });
      return { answer: (items: ImageArtifactRef[]) => answer(items), signal: () => signal };
    };
    const ids = () => useImageArtifactStore.getState().artifacts.map((a) => a.artifact_id);

    it("a response authorized before the gap installs nothing and renews nothing; the post-resume listing re-stamps", async () => {
      let skewMs = 0;
      configureImageLeaseDriver({ wallClock: () => Date.now() + skewMs });
      await vi.advanceTimersByTimeAsync(5_000);
      enableRealImageStore("s1");
      const cache = getArtifactBlobCache();
      const store = () => useImageArtifactStore.getState();
      fakes.listAll.mockResolvedValue(listed(["a1"]));
      await store().refreshSession("s1");
      const lease = await loadImagePreview(makeArtifact("a1"));
      const off = registerImagePreview("s1");
      await vi.advanceTimersByTimeAsync(1_000);

      const beforeSleep = hold(); // authorized (request sent) before the OS suspends
      const pending = store().refreshSession("s1");
      await vi.advanceTimersByTimeAsync(0);
      expect(beforeSleep.signal().aborted).toBe(false);
      const afterResume = hold(); // the listing the resume itself requests
      const renew = vi.spyOn(cache, "renew");
      const order: string[] = [];
      const realInvalidate = cache.invalidateAll.bind(cache);
      vi.spyOn(cache, "invalidateAll").mockImplementation(() => {
        order.push(`invalidate:retired=${beforeSleep.signal().aborted}`);
        realInvalidate();
      });

      skewMs = 120_000; // the OS slept
      const resumedAt = cache.nowMs();
      window.dispatchEvent(new Event("focus"));
      expect(order).toEqual(["invalidate:retired=true"]); // retired BEFORE the invalidation
      expect(afterResume.signal()).toBeDefined(); // fresh run started only after the retire
      expect(afterResume.signal().aborted).toBe(false);
      expect(lease.revoked).toBe(true);
      expect(store().listingStampFor("s1", "r1")).toBeUndefined();
      await pending; // waiter of the retired run was released

      // The pre-sleep response lands after the gap invalidation: nothing may be installed.
      beforeSleep.answer([makeArtifact("zz", { run_id: "r9" })]);
      await vi.advanceTimersByTimeAsync(0);
      expect(renew).not.toHaveBeenCalled();
      expect(ids()).toEqual(["a1"]); // pre-existing artifacts kept, nothing new installed
      expect(store().listingStampFor("s1", "r1")).toBeUndefined();
      expect(store().listingStampFor("s1", "r9")).toBeUndefined();
      expect(lease.revoked).toBe(true);
      fakes.fetchBytes.mockClear();
      expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe("authorization_stale");
      expect(fakes.fetchBytes).not.toHaveBeenCalled();

      // The fresh post-resume listing recovers and stamps at ITS request time.
      afterResume.answer(listed(["a1"]));
      await vi.advanceTimersByTimeAsync(0);
      expect(renew).toHaveBeenCalledTimes(1);
      expect(renew).toHaveBeenCalledWith("s1", "r1", ["a1"], resumedAt);
      expect(store().listingStampFor("s1", "r1")).toBe(resumedAt);
      const recovered = await loadImagePreview(makeArtifact("a1"));
      expect(recovered.url).toBeDefined();
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);
      off();
    });

    it("the gap with no listing in flight retires nothing and still starts a fresh listing", async () => {
      let skewMs = 0;
      configureImageLeaseDriver({ wallClock: () => Date.now() + skewMs });
      await vi.advanceTimersByTimeAsync(5_000);
      enableRealImageStore("s1");
      fakes.listAll.mockResolvedValue(listed(["a1"]));
      await useImageArtifactStore.getState().refreshSession("s1");
      const off = registerImagePreview("s1");
      fakes.listAll.mockClear();
      skewMs = 120_000;
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fakes.listAll).toHaveBeenCalledTimes(1);
      expect(useImageArtifactStore.getState().status).toBe("ready");
      expect(useImageArtifactStore.getState().listingStampFor("s1", "r1")).toBe(
        getArtifactBlobCache().nowMs()
      );
      off();
    });
  });
});
