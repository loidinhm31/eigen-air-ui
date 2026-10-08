import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_PREVIEW_LEASE_MS,
  ArtifactBlobCache,
  ArtifactBlobCacheError,
  disposeArtifactBlobCache,
  getArtifactBlobCache,
  type ArtifactBlobLoader,
  type ArtifactBlobRevokedEvent,
} from "./artifact-blob-cache.js";
import {
  codeOf,
  deferred,
  fakeBlob,
  flush,
  rejection,
  setup,
  type Deferred,
} from "./artifact-blob-cache-test-support.js";
import { useConnectionStore } from "./connectionStore.js";

describe("ArtifactBlobCache lifecycle", () => {
  describe("auto invalidation and dispose", () => {
    it("invalidates on access invalidation, daemon URL change and leaving connected", async () => {
      const t = setup();
      const fill = async () => t.acquire(t.scope("a"), t.load(1));

      await fill();
      t.fireAccess();
      expect(t.cache.getStats().entries).toBe(0);

      await fill();
      t.fireConn({ url: "http://x" }, { url: "http://y" });
      expect(t.cache.getStats().entries).toBe(0);

      await fill();
      t.fireConn({ status: "connecting" }, { status: "connected" });
      expect(t.cache.getStats().entries).toBe(0);

      await fill();
      t.fireConn({ status: "disconnected" }, { status: "connected" });
      expect(t.cache.getStats().entries).toBe(0);

      await fill();
      t.fireConn({ status: "disconnected" }, { status: "connecting" });
      expect(t.cache.getStats().entries).toBe(0);

      await fill();
      t.fireConn({ status: "connected" }, { status: "connecting" });
      t.fireConn({ status: "connected" }, { status: "connected" });
      expect(t.cache.getStats().entries).toBe(1);
    });

    it("dispose unsubscribes, revokes everything and rejects further use", async () => {
      const t = setup();
      const lease = await t.acquire(t.scope("a"), t.load(1));
      const d = deferred();
      const pending = t.acquire(t.scope("b"), () => d.promise);
      await flush();
      t.cache.dispose();
      t.cache.dispose();
      expect(t.offs()).toEqual({ access: 1, conn: 1 });
      expect(t.revoked).toEqual([lease.url]);
      expect(codeOf(await rejection(pending))).toBe("disposed");
      d.resolve(1);
      await flush();
      expect(t.created).toHaveLength(1);
      expect(codeOf(await rejection(t.acquire(t.scope("c"), t.load(1))))).toBe("disposed");
      t.fireAccess();
      expect(t.cache.getStats().entries).toBe(0);
    });

    it("default wiring invalidates when the connection store URL changes; singleton is lazy", async () => {
      const original = useConnectionStore.getState().url;
      const created: string[] = [];
      const revoked: string[] = [];
      const cache = new ArtifactBlobCache({
        now: () => 0,
        getCurrentScope: () => ({ daemonUrl: useConnectionStore.getState().url, accessEpoch: 0 }),
        createObjectURL: () => (created.push("u"), "blob:u"),
        revokeObjectURL: (u) => void revoked.push(u),
      });
      try {
        await cache.acquire(
          { daemonUrl: original, accessEpoch: 0, sessionId: "s", runId: "r", artifactId: "a" },
          () => Promise.resolve(fakeBlob(1)),
          { authorizedAtMs: 0 }
        );
        useConnectionStore.setState({ url: `${original}#changed` });
        expect(revoked).toEqual(["blob:u"]);
        expect(cache.getStats().entries).toBe(0);
        cache.dispose();
        useConnectionStore.setState({ url: original });
        expect(getArtifactBlobCache()).toBe(getArtifactBlobCache());
      } finally {
        useConnectionStore.setState({ url: original });
        disposeArtifactBlobCache();
      }
    });
  });

  describe("preview lease", () => {
    it("expires exactly at 30 s and revokes immediately on expireStale", async () => {
      const t = setup();
      const lease = await t.acquire(t.scope("a"), t.load(3));
      const events: ArtifactBlobRevokedEvent[] = [];
      t.cache.subscribe((e) => events.push(e));
      t.clock.t += ARTIFACT_PREVIEW_LEASE_MS - 1;
      expect(t.cache.isLeaseValid(lease.key)).toBe(true);
      expect(t.cache.expireStale()).toBe(0);
      t.clock.t += 1;
      expect(t.cache.isLeaseValid(lease.key)).toBe(false);
      expect(t.revoked).toEqual([]);
      expect(t.cache.expireStale()).toBe(1);
      expect(t.revoked).toEqual([lease.url]);
      expect(lease.revoked).toBe(true);
      expect(events.map((e) => e.reason)).toEqual(["expired"]);
      expect(t.cache.expireStale()).toBe(0);
      expect(t.revoked).toEqual([lease.url]);
      expect(t.cache.getStats().entries).toBe(0);
    });

    it("renew extends only present, listed entries; hits and transient failures never extend", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      const b = await t.acquire(t.scope("b"), t.load(1));
      const c = await t.acquire(t.scope("c", { runId: "r2" }), t.load(1));
      t.clock.t += 20_000;
      (await t.acquire(t.scope("b"), t.load(1))).release(); // cache hit: no extension
      expect(t.cache.renew("s1", "r1", ["a", "zzz"])).toBe(1);
      t.clock.t += 20_000; // a: 20 s old, b/c: 40 s old
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      expect(t.cache.isLeaseValid(b.key)).toBe(false);
      expect(t.cache.isLeaseValid(c.key)).toBe(false);
      t.cache.expireStale();
      expect(t.revoked).toEqual([c.url, b.url]);
      t.clock.t += 10_000;
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("renew never resurrects an already expired entry", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      t.clock.t += ARTIFACT_PREVIEW_LEASE_MS;
      expect(t.cache.renew("s1", "r1", ["a"])).toBe(0);
      expect(t.revoked).toEqual([a.url]);
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("assertFresh passes when fresh, otherwise revokes and throws", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      expect(() => t.cache.assertFresh(a.key)).not.toThrow();
      t.clock.t += ARTIFACT_PREVIEW_LEASE_MS;
      expect(() => t.cache.assertFresh(a.key)).toThrow(ArtifactBlobCacheError);
      expect(t.revoked).toEqual([a.url]);
      expect(() => t.cache.assertFresh("missing")).toThrow(ArtifactBlobCacheError);
    });

    it("expired entries are never served: acquire revokes and reloads", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      t.clock.t += ARTIFACT_PREVIEW_LEASE_MS;
      const again = await t.acquire(t.scope("a"), t.load(1));
      expect(t.revoked).toEqual([a.url]);
      expect(again.url).not.toBe(a.url);
      expect(t.cache.isLeaseValid(again.key)).toBe(true);
    });

    it("treats entries from a stale scope as invalid and revokes them", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      t.current.accessEpoch = 2;
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
      expect(t.cache.expireStale()).toBe(1);
      expect(t.revoked).toEqual([a.url]);
    });

    it("anchors the lease at the authorizing listing: load finishing after t0+30 s installs nothing", async () => {
      const t = setup();
      const t0 = t.clock.t; // listing time
      t.advance(29_000);
      const d = deferred();
      const p = t.acquire(t.scope("a"), () => d.promise, { authorizedAtMs: t0 });
      await flush();
      t.clock.t += 1_000; // now = t0 + 30 s, deadline timer not driven: install still checks
      d.resolve(1);
      expect(codeOf(await rejection(p))).toBe("lease_expired");
      expect(t.created).toEqual([]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, inFlight: 0 });
    });

    it("entry lease is measured from the listing, not from acquire/install", async () => {
      const t = setup();
      const t0 = t.clock.t;
      t.advance(10_000);
      const a = await t.acquire(t.scope("a"), t.load(1), { authorizedAtMs: t0 });
      t.advance(19_999);
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      t.advance(1);
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("rejects a stale or invalid anchor before queueing or loading", async () => {
      const t = setup();
      const t0 = t.clock.t;
      t.advance(ARTIFACT_PREVIEW_LEASE_MS);
      let called = 0;
      const loader = () => (called++, Promise.resolve(fakeBlob(1)));
      for (const at of [t0, t0 - 5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          codeOf(await rejection(t.acquire(t.scope("a"), loader, { authorizedAtMs: at })))
        ).toBe("lease_expired");
      }
      expect(called).toBe(0);
      expect(t.pendingTimers()).toBe(0);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, inFlight: 0, queued: 0 });
      // Boundary: 1 ms inside the lease is accepted.
      (await t.acquire(t.scope("a"), loader, { authorizedAtMs: t0 + 1 })).release();
      expect(called).toBe(1);
    });

    it("clamps a future anchor to now (cannot buy extra lease)", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1), { authorizedAtMs: t.clock.t + 60_000 });
      t.advance(ARTIFACT_PREVIEW_LEASE_MS);
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("a cache hit never extends the lease even with a newer anchor", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      t.advance(20_000);
      (await t.acquire(t.scope("a"), t.load(1))).release();
      t.advance(10_000);
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("renew with a newer listing time extends; an older one never shortens", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      const b = await t.acquire(t.scope("b"), t.load(1));
      const t0 = t.clock.t;
      t.advance(20_000);
      const listing = t.cache.nowMs();
      t.advance(5_000);
      expect(t.cache.renew("s1", "r1", ["a"], listing)).toBe(1); // a anchor = t0+20 s
      expect(t.cache.renew("s1", "r1", ["b"], t0 - 10_000)).toBe(1);
      expect(t.cache.isLeaseValid(b.key)).toBe(true); // older listing must not shorten (t0-10 s+30 s < now)
      t.advance(9_999); // t0 + 34.999 s: b (anchor t0) is 30 s old => expired
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      expect(t.cache.isLeaseValid(b.key)).toBe(false);
      t.advance(1); // t0 + 35 s: a anchor t0+20 s is only 15 s old
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      t.advance(15_000); // t0 + 50 s => a age 30 s
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
    });

    it("renew clamps a future anchor and defaults to now", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      t.advance(10_000);
      t.cache.renew("s1", "r1", ["a"], t.clock.t + 100_000);
      t.advance(29_999);
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      t.advance(1);
      expect(t.cache.isLeaseValid(a.key)).toBe(false);
      const b = await t.acquire(t.scope("b"), t.load(1));
      t.advance(10_000);
      t.cache.renew("s1", "r1", ["b"]);
      t.advance(29_999);
      expect(t.cache.isLeaseValid(b.key)).toBe(true);
    });

    it("nowMs follows the cache clock", () => {
      const t = setup();
      expect(t.cache.nowMs()).toBe(t.clock.t);
    });
  });

  describe("lease deadline and stalled loads", () => {
    /** Loader that honours abort by rejecting (like fetch). */
    const abortable = (): ArtifactBlobLoader => (signal) =>
      new Promise<Blob>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("loader aborted")), { once: true })
      );

    it("deadline timer aborts a load listed at t0 and acquired at t0+29 s; late bytes never install", async () => {
      const t = setup();
      const t0 = t.clock.t;
      t.advance(29_000);
      const d = deferred();
      let signal!: AbortSignal;
      const p = t.acquire(t.scope("a"), (s) => ((signal = s), d.promise), { authorizedAtMs: t0 });
      await flush();
      expect(t.pendingTimers()).toBe(1);
      t.advance(1_000);
      expect(signal.aborted).toBe(true);
      expect(codeOf(await rejection(p))).toBe("lease_expired");
      d.resolve(1);
      await flush();
      expect(t.created).toEqual([]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, inFlight: 0, queued: 0 });
      expect(t.pendingTimers()).toBe(0);
    });

    it("both slots stalling past the deadline do not block a healthy later artifact", async () => {
      const t = setup();
      const t0 = t.clock.t;
      const pa = t.acquire(t.scope("a"), abortable());
      const pb = t.acquire(t.scope("b"), abortable());
      t.advance(10_000);
      const pc = t.acquire(t.scope("c"), t.load(7), { authorizedAtMs: t0 + 10_000 });
      await flush();
      expect(t.cache.getStats()).toMatchObject({ inFlight: 2, queued: 1 });
      t.advance(20_000); // a/b deadline (t0+30 s) fires; c's own deadline is t0+40 s
      expect(codeOf(await rejection(pa))).toBe("lease_expired");
      expect(codeOf(await rejection(pb))).toBe("lease_expired");
      const lease = await pc; // slots freed once the abortable loaders settled
      expect(t.cache.getStats()).toMatchObject({ entries: 1, inFlight: 0, queued: 0 });
      expect(t.pendingTimers()).toBe(0);
      lease.release();
    });

    it("a loader that ignores abort keeps its slot until it settles; never > 2 active", async () => {
      const t = setup();
      const t0 = t.clock.t;
      let running = 0;
      let maxRunning = 0;
      const stubborn =
        (id: string, ds: Map<string, Deferred>): ArtifactBlobLoader =>
        () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          const d = deferred();
          ds.set(id, d);
          return d.promise.finally(() => running--);
        };
      const ds = new Map<string, Deferred>();
      const pa = t.acquire(t.scope("a"), stubborn("a", ds));
      const pb = t.acquire(t.scope("b"), stubborn("b", ds));
      t.advance(10_000);
      let cStarted = false;
      const pc = t.acquire(t.scope("c"), () => ((cStarted = true), Promise.resolve(fakeBlob(1))), {
        authorizedAtMs: t0 + 10_000,
      });
      await flush();
      t.advance(20_000); // a/b deadline
      expect(codeOf(await rejection(pa))).toBe("lease_expired");
      expect(codeOf(await rejection(pb))).toBe("lease_expired");
      expect(t.cache.getStats()).toMatchObject({ inFlight: 2, queued: 1 }); // still active
      expect(cStarted).toBe(false);
      t.advance(10_000); // c's own deadline passes while queued
      expect(codeOf(await rejection(pc))).toBe("lease_expired");
      expect(t.cache.getStats()).toMatchObject({ inFlight: 2, queued: 0 });
      expect(cStarted).toBe(false);
      // Fresh artifact waits behind the stuck loaders, then runs once one settles.
      const pd = t.acquire(t.scope("d"), t.load(3));
      await flush();
      expect(t.cache.getStats()).toMatchObject({ inFlight: 2, queued: 1 });
      ds.get("a")!.resolve(99); // late bytes of a dead load: dropped
      const lease = await pd;
      expect(t.created).toHaveLength(1);
      expect(t.cache.getStats()).toMatchObject({ entries: 1, totalBytes: 3, queued: 0 });
      ds.get("b")!.resolve(99);
      await flush();
      expect(t.created).toHaveLength(1);
      expect(t.cache.getStats().inFlight).toBe(0);
      expect(maxRunning).toBeLessThanOrEqual(2);
      lease.release();
    });

    it("scope change during a load: result fenced, stalled loader bounded by the deadline", async () => {
      const t = setup();
      const d = deferred();
      const pa = t.acquire(t.scope("a"), () => d.promise);
      const pb = t.acquire(t.scope("b"), abortable());
      await flush();
      t.current.accessEpoch = 2; // no invalidation event: only fences + deadline protect
      d.resolve(1);
      expect(codeOf(await rejection(pa))).toBe("stale_scope");
      expect(t.pendingTimers()).toBe(1);
      t.advance(30_000);
      expect(codeOf(await rejection(pb))).toBe("lease_expired");
      await flush();
      expect(t.created).toEqual([]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, inFlight: 0 });
      expect(t.pendingTimers()).toBe(0);
    });

    it("newer sharer listing re-arms the deadline (newest anchor wins, older never shortens)", async () => {
      const t = setup();
      const t0 = t.clock.t;
      const d = deferred();
      const p1 = t.acquire(t.scope("a"), () => d.promise, { authorizedAtMs: t0 });
      t.advance(20_000);
      const p2 = t.acquire(t.scope("a"), () => d.promise); // listing at t0+20 s
      const p3 = t.acquire(t.scope("a"), () => d.promise, { authorizedAtMs: t0 + 5_000 });
      await flush();
      t.advance(25_000); // t0+45 s: past the first anchor, inside the second
      expect(t.pendingTimers()).toBe(1);
      d.resolve(2);
      const [l1, l2, l3] = await Promise.all([p1, p2, p3]);
      expect(l1.url).toBe(l3.url);
      expect(l2.url).toBe(l1.url);
      expect(t.cache.isLeaseValid(l1.key)).toBe(true); // anchor t0+20 s
      t.advance(5_000);
      expect(t.cache.isLeaseValid(l1.key)).toBe(false);
    });

    it("clears deadline timers on success, failure, abort, invalidation and dispose", async () => {
      const t = setup();
      (await t.acquire(t.scope("ok"), t.load(1))).release();
      expect(t.pendingTimers()).toBe(0);
      await rejection(t.acquire(t.scope("bad"), () => Promise.reject(new Error("x"))));
      expect(t.pendingTimers()).toBe(0);

      const ac = new AbortController();
      const pAbort = t.acquire(t.scope("ab"), abortable(), { signal: ac.signal });
      await flush();
      ac.abort();
      await rejection(pAbort);
      expect(t.pendingTimers()).toBe(0);

      const pInv = t.acquire(t.scope("inv"), abortable());
      await flush();
      t.cache.invalidateScope({ artifactIds: ["inv"] });
      await rejection(pInv);
      expect(t.pendingTimers()).toBe(0);

      const running = t.acquire(t.scope("r1"), abortable());
      const running2 = t.acquire(t.scope("r2"), abortable());
      const queued = t.acquire(t.scope("q"), abortable());
      await flush();
      expect(t.pendingTimers()).toBe(3);
      t.cache.dispose();
      for (const p of [running, running2, queued])
        expect(codeOf(await rejection(p))).toBe("disposed");
      expect(t.pendingTimers()).toBe(0);
      t.advance(60_000); // nothing left to fire
      expect(t.cache.getStats().queued).toBe(0);
    });

    afterEach(() => disposeArtifactBlobCache());
  });
});
