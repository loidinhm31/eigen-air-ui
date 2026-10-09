// @vitest-environment jsdom
/** Preview loader (stamp/lease/scope fence/error mapping) and download helper behavior. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
} from "../adapters/factory/interfaces/IArtifactAdapter.js";
import { setServiceAccessContext } from "../adapters/factory/ServiceFactory.js";
import { getArtifactBlobCache } from "./artifact-blob-cache.js";
import { useConnectionStore } from "./connectionStore.js";
import { useImageArtifactStore } from "./image-artifact-store.js";
import { downloadImageArtifact } from "./image-download.js";
import {
  ImagePreviewError,
  isLeaseUsable,
  loadImagePreview,
  setPreviewAdmissionCapacity,
  type ImagePreviewErrorCode,
} from "./image-preview-loader.js";
import {
  codeOf,
  enableRealImageStore,
  fakeBytes,
  installImagePreviewFakes,
  LEASE_MS,
  makeArtifact,
  manualDownload,
  manualLoader,
  stampListing,
} from "./image-preview-test-support.js";

const fakes = installImagePreviewFakes();

describe("loadImagePreview: authorization stamp", () => {
  it("rejects stale without a stamp, triggers a session refresh and fetches nothing", async () => {
    useImageArtifactStore.setState({ activeSessionId: "s1", listingStamps: {} });
    expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe("authorization_stale");
    expect(fakes.refresh).toHaveBeenCalledWith("s1");
    expect(fakes.fetchBytes).not.toHaveBeenCalled();
  });

  it("loads inline bytes for a fresh stamp and installs one leased URL", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);
    expect(fakes.fetchBytes.mock.calls[0]?.[0]).toEqual({
      artifactId: "a1",
      sessionId: "s1",
      runId: "r1",
      byteSize: 141,
      sha256: "a".repeat(64),
      width: 256,
      height: 256,
    });
    expect(fakes.fetchBytes.mock.calls[0]?.[1]).toMatchObject({ disposition: "inline" });
    expect(lease.url).toBe("blob:fake/1");
    expect(isLeaseUsable(lease)).toBe(true);
    expect(fakes.refresh).not.toHaveBeenCalled();
  });

  it("rejects a stamp exactly 30 s old, accepts one 29.999 s old", async () => {
    const t0 = stampListing();
    await vi.advanceTimersByTimeAsync(LEASE_MS - 1);
    const lease = await loadImagePreview(makeArtifact("a1"));
    expect(isLeaseUsable(lease)).toBe(true);
    lease.release();
    await vi.advanceTimersByTimeAsync(1);
    expect(getArtifactBlobCache().nowMs() - t0).toBe(LEASE_MS);
    expect(await codeOf(loadImagePreview(makeArtifact("a2")))).toBe("authorization_stale");
    expect(fakes.refresh).toHaveBeenCalledWith("s1");
  });

  it("listing at t=0, preview acquired at t=29 s: lease ends at t=30 s, not t=59 s", async () => {
    stampListing();
    await vi.advanceTimersByTimeAsync(29_000);
    const lease = await loadImagePreview(makeArtifact("a1"));
    expect(isLeaseUsable(lease)).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(isLeaseUsable(lease)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(isLeaseUsable(lease)).toBe(false);
    expect(getArtifactBlobCache().expireStale()).toBe(1);
    expect(fakes.revoked).toEqual(["blob:fake/1"]);
    expect(lease.revoked).toBe(true);
  });

  it("a load finishing after the lease deadline installs nothing and asks for a refresh", async () => {
    stampListing();
    const loader = manualLoader(fakes);
    const pending = codeOf(loadImagePreview(makeArtifact("a1")));
    await vi.advanceTimersByTimeAsync(LEASE_MS);
    loader.finish();
    expect(await pending).toBe("authorization_stale");
    expect(fakes.created).toHaveLength(0);
    expect(fakes.refresh).toHaveBeenCalledWith("s1");
  });

  it("only committed artifacts load", async () => {
    stampListing();
    for (const state of ["unavailable", "deleted"] as const) {
      expect(await codeOf(loadImagePreview(makeArtifact("a1", { state })))).toBe("unavailable");
    }
    expect(fakes.fetchBytes).not.toHaveBeenCalled();
  });

  it("maps caller abort (before and during the load) to aborted", async () => {
    stampListing();
    const pre = new AbortController();
    pre.abort();
    expect(await codeOf(loadImagePreview(makeArtifact("a1"), { signal: pre.signal }))).toBe(
      "aborted"
    );
    fakes.fetchBytes.mockImplementation(() => new Promise(() => undefined));
    const mid = new AbortController();
    const pending = codeOf(loadImagePreview(makeArtifact("a1"), { signal: mid.signal }));
    mid.abort();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
  });
});

describe("loadImagePreview: stamp lookup is prototype- and finite-safe", () => {
  const HOSTILE_RUN_IDS = ["__proto__", "constructor", "toString"];

  it.each(HOSTILE_RUN_IDS)(
    "run id %s without an own stamp never authorizes bytes",
    async (runId) => {
      useImageArtifactStore.setState({
        activeSessionId: "s1",
        listingStamps: { r1: getArtifactBlobCache().nowMs() },
      });
      expect(await codeOf(loadImagePreview(makeArtifact("a1", { run_id: runId })))).toBe(
        "authorization_stale"
      );
      expect(fakes.refresh).toHaveBeenCalledWith("s1");
      expect(fakes.fetchBytes).not.toHaveBeenCalled();
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "a non-finite stamp (%s) takes the stale path",
    async (bad) => {
      useImageArtifactStore.setState({ activeSessionId: "s1", listingStamps: { r1: bad } });
      expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe("authorization_stale");
      expect(fakes.refresh).toHaveBeenCalledWith("s1");
      expect(fakes.fetchBytes).not.toHaveBeenCalled();
    }
  );

  it("a non-number stamp from any store (prototype object, function) is stale", async () => {
    const real = useImageArtifactStore.getState().listingStampFor;
    try {
      for (const bogus of [Object.prototype, Object, () => 1, "5", null]) {
        useImageArtifactStore.setState({
          listingStampFor: (() => bogus) as unknown as typeof real,
        });
        expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe("authorization_stale");
      }
      expect(fakes.fetchBytes).not.toHaveBeenCalled();
    } finally {
      useImageArtifactStore.setState({ listingStampFor: real });
    }
  });

  it.each(HOSTILE_RUN_IDS)(
    "run id %s with a legitimate own stamp (real listing) loads like any id",
    async (runId) => {
      await vi.advanceTimersByTimeAsync(5_000);
      enableRealImageStore("s1");
      const artifact = makeArtifact("a1", { run_id: runId });
      fakes.listAll.mockResolvedValue([artifact]);
      await useImageArtifactStore.getState().refreshSession("s1");
      expect(useImageArtifactStore.getState().listingStampFor("s1", runId)).toBe(
        getArtifactBlobCache().nowMs()
      );

      const lease = await loadImagePreview(artifact);
      expect(isLeaseUsable(lease)).toBe(true);
      expect(fakes.fetchBytes.mock.calls[0]?.[0]).toMatchObject({ runId });
      expect(lease.url).toBe("blob:fake/1");
    }
  );
});

describe("loadImagePreview: scope fence", () => {
  it("shows nothing when the access epoch changes before the loader resolves", async () => {
    stampListing();
    const loader = manualLoader(fakes);
    const pending = codeOf(loadImagePreview(makeArtifact("a1")));
    await vi.advanceTimersByTimeAsync(0);
    setServiceAccessContext({ authToken: "t2" }); // bumps accessRevision, invalidates the cache
    loader.finish();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
    expect(getArtifactBlobCache().getStats().entries).toBe(0);
  });

  it("revokes a displayed lease on epoch change", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    setServiceAccessContext({ authToken: "t3" });
    expect(lease.revoked).toBe(true);
    expect(isLeaseUsable(lease)).toBe(false);
    expect(fakes.revoked).toEqual(["blob:fake/1"]);
  });

  it("shows nothing when the daemon URL changes mid-load", async () => {
    stampListing();
    const loader = manualLoader(fakes);
    const pending = codeOf(loadImagePreview(makeArtifact("a1")));
    await vi.advanceTimersByTimeAsync(0);
    useConnectionStore.setState({ url: "http://d2" });
    loader.finish();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
  });
});

describe("error mapping", () => {
  const adapterCases: Array<
    [ArtifactAdapterErrorKind, ConstructorParameters<typeof ArtifactAdapterError>[1], string]
  > = [
    ["unsupported", undefined, "unsupported"],
    ["unauthorized", { status: 401 }, "denied"],
    ["not_found", { status: 404 }, "denied"],
    ["unavailable", { status: 503, code: "image_busy" }, "busy"],
    ["unavailable", { status: 503, code: "image_resource_unavailable" }, "busy"],
    ["unavailable", { status: 503, code: "image_native_failed" }, "failed"],
    ["integrity", undefined, "failed"],
    ["too_large", undefined, "failed"],
    ["network", undefined, "failed"],
    ["protocol", undefined, "failed"],
    ["aborted", undefined, "aborted"],
  ];

  it.each(adapterCases)("adapter %s %j -> %s", async (kind, options, expected) => {
    stampListing();
    fakes.fetchBytes.mockRejectedValue(new ArtifactAdapterError(kind, options));
    expect(await codeOf(loadImagePreview(makeArtifact("a1")))).toBe(expected);
  });

  it("never echoes error text", async () => {
    stampListing();
    fakes.fetchBytes.mockRejectedValue(new Error("secret prompt text /etc/passwd"));
    await expect(loadImagePreview(makeArtifact("a1"))).rejects.toThrow(/^image_preview_failed$/);
  });

  it("denied drops every cached preview of that session/run, other runs stay", async () => {
    const now = getArtifactBlobCache().nowMs();
    useImageArtifactStore.setState({
      activeSessionId: "s1",
      listingStamps: { r1: now, r2: now },
    });
    const sibling = await loadImagePreview(makeArtifact("a1"));
    const otherRun = await loadImagePreview(makeArtifact("b1", { run_id: "r2" }));
    fakes.fetchBytes.mockRejectedValue(new ArtifactAdapterError("not_found", { status: 404 }));
    expect(await codeOf(loadImagePreview(makeArtifact("a2")))).toBe("denied");
    expect(sibling.revoked).toBe(true);
    expect(otherRun.revoked).toBe(false);
  });
});

describe("preview admission (capacity-gated FIFO queue)", () => {
  afterEach(() => setPreviewAdmissionCapacity(undefined));

  async function fillPool(count = 8) {
    stampListing();
    const leases = [];
    for (let i = 1; i <= count; i++) leases.push(await loadImagePreview(makeArtifact(`p${i}`)));
    return leases;
  }

  /** Observe a load without awaiting it: pending until it settles; `code` is the typed failure. */
  function track(promise: Promise<unknown>) {
    const state = {
      done: false,
      error: undefined as unknown,
      code: undefined as ImagePreviewErrorCode | undefined,
    };
    promise.then(
      () => void (state.done = true),
      (error: unknown) => {
        state.done = true;
        state.error = error;
        if (error instanceof ImagePreviewError) state.code = error.code;
      }
    );
    return state;
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("a visible load beyond the pool waits instead of failing, fetches nothing and reports queueing", async () => {
    await fillPool();
    const onQueueChange = vi.fn();
    const waiting = track(loadImagePreview(makeArtifact("p9"), { onQueueChange }));
    await flush();
    expect(onQueueChange.mock.calls).toEqual([[true]]);
    expect(waiting.done).toBe(false);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(8);
  });

  it("admits exactly one waiter per freed slot, in arrival order, and never wakes the rest", async () => {
    const leases = await fillPool();
    const onQueueChange = [vi.fn(), vi.fn(), vi.fn()];
    const waiters = ["p9", "p10", "p11"].map((id, i) =>
      track(loadImagePreview(makeArtifact(id), { onQueueChange: onQueueChange[i] }))
    );
    await flush();
    expect(waiters.map((w) => w.done)).toEqual([false, false, false]);

    leases[0]?.release();
    leases[0]?.release(); // idempotent: frees one slot only
    await flush();
    expect(waiters.map((w) => w.done)).toEqual([true, false, false]);
    expect(onQueueChange[0]?.mock.calls).toEqual([[true], [false]]);
    expect(onQueueChange[1]?.mock.calls).toEqual([[true]]);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(9);

    leases[1]?.release();
    await flush();
    expect(waiters.map((w) => w.done)).toEqual([true, true, false]);
    leases[2]?.release();
    await flush();
    expect(waiters.map((w) => w.done)).toEqual([true, true, true]);
    expect(waiters.every((w) => w.error === undefined)).toBe(true);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(11);
  });

  it("with an injected capacity of 4, K+3 waiters all load as slots are released one by one (no failures, no budget)", async () => {
    setPreviewAdmissionCapacity(4);
    const leases = await fillPool(4);
    const waiters = ["w1", "w2", "w3"].map((id) => track(loadImagePreview(makeArtifact(id))));
    await flush();
    expect(waiters.map((w) => w.done)).toEqual([false, false, false]);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(4);

    for (let i = 0; i < 3; i++) {
      leases[i]?.release();
      await flush();
      expect(waiters.map((w) => w.done)).toEqual([0, 1, 2].map((n) => n <= i));
    }
    expect(waiters.every((w) => w.error === undefined)).toBe(true);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(7);
  });

  it("raising the capacity admits the queued waiters that now fit", async () => {
    setPreviewAdmissionCapacity(2);
    await fillPool(2);
    const waiting = track(loadImagePreview(makeArtifact("w1")));
    await flush();
    expect(waiting.done).toBe(false);
    setPreviewAdmissionCapacity(3);
    await flush();
    expect(waiting.done).toBe(true);
  });

  it("an aborted waiter leaves the queue (rejects `aborted`, fetches nothing) and the next one gets the freed slot", async () => {
    const leases = await fillPool();
    const controller = new AbortController();
    const dropped = track(loadImagePreview(makeArtifact("p9"), { signal: controller.signal }));
    const next = track(loadImagePreview(makeArtifact("p10")));
    await flush();

    controller.abort();
    await flush();
    expect(dropped.done).toBe(true);
    expect(dropped.code).toBe("aborted");

    leases[0]?.release();
    await flush();
    expect(next.done).toBe(true);
    expect(next.error).toBeUndefined();
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(9); // 8 + p10 only
  });

  it("a waiter aborted in the same tick it is admitted frees the slot again", async () => {
    const leases = await fillPool();
    const controller = new AbortController();
    const doomed = track(loadImagePreview(makeArtifact("p9"), { signal: controller.signal }));
    const next = track(loadImagePreview(makeArtifact("p10")));
    await flush();

    leases[0]?.release(); // admits p9 ...
    controller.abort(); // ... which is aborted before it can start
    await flush();
    expect(doomed.code).toBe("aborted");
    expect(next.done).toBe(true);
    expect(next.error).toBeUndefined();
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(9);
  });

  it("a failed admitted load (adapter error) hands its slot to the next waiter", async () => {
    const leases = await fillPool();
    fakes.fetchBytes.mockRejectedValueOnce(new Error("boom"));
    const failing = track(loadImagePreview(makeArtifact("p9")));
    const next = track(loadImagePreview(makeArtifact("p10")));
    await flush();

    leases[0]?.release();
    await flush();
    expect(failing.code).toBe("failed");
    expect(next.done).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it("a revoked pinned entry frees its slot even if its lease is never released", async () => {
    await fillPool();
    const waiting = track(loadImagePreview(makeArtifact("p9")));
    await flush();
    expect(waiting.done).toBe(false);

    setServiceAccessContext({ authToken: "t9" }); // revokes every entry, leases still held
    await flush();
    expect(waiting.done).toBe(true);
  });

  it("a second view of an already leased artifact shares its slot instead of waiting", async () => {
    await fillPool();
    const again = track(loadImagePreview(makeArtifact("p3")));
    await flush();
    expect(again.done).toBe(true);
    expect(again.error).toBeUndefined();
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(8);
  });

  it("re-validates the authorization after waiting: an aged listing refreshes instead of fetching", async () => {
    const leases = await fillPool();
    const waiting = track(loadImagePreview(makeArtifact("p9")));
    await flush();

    await vi.advanceTimersByTimeAsync(LEASE_MS + 1); // the listing authorizing p9 has aged out
    fakes.refresh.mockClear();
    leases[0]?.release();
    await flush();
    expect(waiting.code).toBe("authorization_stale");
    expect(fakes.refresh).toHaveBeenCalledWith("s1");
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(8);
  });

  describe("cache-level capacity (admission bypassed)", () => {
    it("a fully pinned pool maps to `capacity` without fetching and leaves no slot held", async () => {
      setPreviewAdmissionCapacity(100);
      const leases = await fillPool();
      expect(await codeOf(loadImagePreview(makeArtifact("p9")))).toBe("capacity");
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(8);

      leases[0]?.release();
      const lease = await loadImagePreview(makeArtifact("p9"));
      expect(isLeaseUsable(lease)).toBe(true);
    });

    it("install-time capacity_exhausted after the download fails once with `capacity`: no automatic retry, slot freed", async () => {
      stampListing();
      fakes.fetchBytes.mockResolvedValue(fakeBytes(16 * 1024 * 1024));
      setPreviewAdmissionCapacity(100);
      for (let i = 1; i <= 4; i++) await loadImagePreview(makeArtifact(`big${i}`)); // 64 MiB pinned
      setPreviewAdmissionCapacity(5); // one free slot, but no byte budget left for another entry
      fakes.fetchBytes.mockClear();

      expect(await codeOf(loadImagePreview(makeArtifact("big5")))).toBe("capacity");
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(1); // downloaded once, never looped
      await flush();
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);

      // The failed attempt gave its slot back: the next load is admitted at once (not queued).
      const next = track(loadImagePreview(makeArtifact("big6")));
      await flush();
      expect(next.code).toBe("capacity");
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(2);
    });
  });
});

describe("downloadImageArtifact", () => {
  it("does a fresh attachment GET even when the preview is cached, then revokes its transient URL", async () => {
    stampListing();
    const preview = await loadImagePreview(makeArtifact("a1"));
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);

    await downloadImageArtifact(makeArtifact("a1"));
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1); // preview cache untouched
    expect(fakes.download).toHaveBeenCalledTimes(1);
    expect(fakes.download.mock.calls[0]?.[0]).toMatchObject({ artifactId: "a1", sessionId: "s1" });
    expect(fakes.clicks).toEqual([{ href: "blob:fake/2", download: "a1.png" }]);
    expect(fakes.revoked).toEqual([]); // revoked on the next macrotask, not synchronously
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.revoked).toEqual(["blob:fake/2"]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(preview.revoked).toBe(false);

    await downloadImageArtifact(makeArtifact("a1"));
    expect(fakes.download).toHaveBeenCalledTimes(2); // never cached
  });

  it("revokes immediately when the click fails", async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await codeOf(downloadImageArtifact(makeArtifact("a1")))).toBe("failed");
    expect(fakes.revoked).toEqual(["blob:fake/1"]);
  });

  it("expires stale preview URLs before downloading", async () => {
    stampListing();
    const lease = await loadImagePreview(makeArtifact("a1"));
    await vi.advanceTimersByTimeAsync(LEASE_MS + 5_000);
    expect(lease.revoked).toBe(false);
    await downloadImageArtifact(makeArtifact("a1"));
    expect(lease.revoked).toBe(true);
  });

  it("rejects non-committed artifacts and pre-aborted calls without a request", async () => {
    expect(await codeOf(downloadImageArtifact(makeArtifact("a1", { state: "unavailable" })))).toBe(
      "unavailable"
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      await codeOf(downloadImageArtifact(makeArtifact("a1"), { signal: controller.signal }))
    ).toBe("aborted");
    expect(fakes.download).not.toHaveBeenCalled();
  });

  it("discards the blob when the access epoch changes during the download GET", async () => {
    const dl = manualDownload(fakes);
    const pending = codeOf(downloadImageArtifact(makeArtifact("a1")));
    await vi.advanceTimersByTimeAsync(0);
    setServiceAccessContext({ authToken: "t2" });
    dl.finish();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
    expect(fakes.clicks).toHaveLength(0);
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("discards the blob when the daemon URL changes during the download GET", async () => {
    const dl = manualDownload(fakes);
    const pending = codeOf(downloadImageArtifact(makeArtifact("a1")));
    await vi.advanceTimersByTimeAsync(0);
    useConnectionStore.setState({ url: "http://d2" });
    dl.finish();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
    expect(fakes.clicks).toHaveLength(0);
  });

  it("discards the blob when the signal aborts while the adapter ignores it", async () => {
    const controller = new AbortController();
    const dl = manualDownload(fakes);
    const pending = codeOf(
      downloadImageArtifact(makeArtifact("a1"), { signal: controller.signal })
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    dl.finish();
    expect(await pending).toBe("aborted");
    expect(fakes.created).toHaveLength(0);
    expect(fakes.clicks).toHaveLength(0);
  });

  it("maps unsupported and denied; denied marks the scope", async () => {
    fakes.download.mockRejectedValueOnce(new ArtifactAdapterError("unsupported"));
    expect(await codeOf(downloadImageArtifact(makeArtifact("a1")))).toBe("unsupported");

    stampListing();
    const preview = await loadImagePreview(makeArtifact("a2"));
    fakes.download.mockRejectedValueOnce(new ArtifactAdapterError("unauthorized", { status: 401 }));
    expect(await codeOf(downloadImageArtifact(makeArtifact("a1")))).toBe("denied");
    expect(preview.revoked).toBe(true);
    expect(fakes.clicks).toHaveLength(0);
  });
});
