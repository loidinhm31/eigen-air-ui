import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_CACHE_MAX_ENTRY_BYTES,
  buildArtifactBlobKey,
  disposeArtifactBlobCache,
  type ArtifactBlobRevokedEvent,
} from "./artifact-blob-cache.js";
import {
  MIB,
  codeOf,
  deferred,
  fakeBlob,
  flush,
  rejection,
  setup,
  type Deferred,
} from "./artifact-blob-cache-test-support.js";

describe("ArtifactBlobCache", () => {
  it("builds collision-free keys", () => {
    const base = {
      daemonUrl: "http://d",
      accessEpoch: 2,
      sessionId: "s",
      runId: "r",
      artifactId: "a",
    };
    expect(buildArtifactBlobKey(base)).toBe("http%3A%2F%2Fd::2::s::r::a");
    const k1 = buildArtifactBlobKey({ ...base, sessionId: "a::b", runId: "c" });
    const k2 = buildArtifactBlobKey({ ...base, sessionId: "a", runId: "b::c" });
    expect(k1).not.toBe(k2);
  });

  describe("sharing, refcount, eviction", () => {
    it("shares one load between concurrent acquires and one URL per entry", async () => {
      const t = setup();
      const d = deferred();
      let calls = 0;
      const loader = () => {
        calls++;
        return d.promise;
      };
      const p1 = t.acquire(t.scope("a"), loader);
      const p2 = t.acquire(t.scope("a"), loader);
      await flush();
      d.resolve(100);
      const [l1, l2] = await Promise.all([p1, p2]);
      expect(calls).toBe(1);
      expect(t.created).toHaveLength(1);
      expect(l1.url).toBe(l2.url);
      expect(t.cache.getStats()).toMatchObject({ entries: 1, totalBytes: 100, inFlight: 0 });
      const l3 = await t.acquire(t.scope("a"), () => Promise.reject(new Error("must not load")));
      expect(l3.url).toBe(l1.url);
      expect(t.created).toHaveLength(1);
    });

    it("release is idempotent and unreferenced entries stay cached until evicted (URL revoked once)", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(10));
      const b = await t.acquire(t.scope("a"), t.load(10));
      a.release();
      a.release();
      a.release();
      expect(t.revoked).toEqual([]);
      // `b` still pins the entry: fill the cache; `a` must survive.
      for (let i = 0; i < 7; i++) (await t.acquire(t.scope(`x${i}`), t.load(1))).release();
      expect(t.revoked).toEqual([]);
      expect(t.cache.getStats().entries).toBe(8);
      expect(t.cache.isLeaseValid(a.key)).toBe(true);
      b.release();
      (await t.acquire(t.scope("y"), t.load(1))).release();
      expect(t.revoked).toEqual([a.url]);
      expect(t.cache.getStats().entries).toBe(8);
    });

    it("evicts least-recently-used unreferenced entry at 8 entries", async () => {
      const t = setup();
      const leases = [];
      for (let i = 0; i < 8; i++) leases.push(await t.acquire(t.scope(`a${i}`), t.load(1)));
      leases.forEach((l) => l.release());
      (await t.acquire(t.scope("a0"), t.load(1))).release(); // touch a0 => a1 is LRU
      (await t.acquire(t.scope("new"), t.load(1))).release();
      expect(t.revoked).toEqual([leases[1].url]);
      expect(t.cache.getStats().entries).toBe(8);
      expect(t.cache.isLeaseValid(leases[0].key)).toBe(true);
      expect(t.cache.isLeaseValid(leases[1].key)).toBe(false);
    });

    it("keeps total bytes <= 64 MiB by evicting LRU unreferenced entries", async () => {
      const t = setup();
      const ls = [];
      for (let i = 0; i < 4; i++) ls.push(await t.acquire(t.scope(`b${i}`), t.load(16 * MIB)));
      ls.forEach((l) => l.release());
      expect(t.cache.getStats().totalBytes).toBe(64 * MIB);
      const extra = await t.acquire(t.scope("extra"), t.load(5 * MIB));
      expect(t.revoked).toEqual([ls[0].url]);
      expect(t.cache.getStats()).toMatchObject({ entries: 4, totalBytes: 48 * MIB + 5 * MIB });
      extra.release();
    });

    it("rejects entries over 16 MiB without creating a URL", async () => {
      const t = setup();
      const e = await rejection(
        t.acquire(t.scope("big"), t.load(ARTIFACT_CACHE_MAX_ENTRY_BYTES + 1))
      );
      expect(codeOf(e)).toBe("entry_too_large");
      expect(t.created).toEqual([]);
      expect(t.cache.getStats().entries).toBe(0);
      (await t.acquire(t.scope("ok"), t.load(ARTIFACT_CACHE_MAX_ENTRY_BYTES))).release();
      expect(t.created).toHaveLength(1);
    });

    it("rejects when all 8 entries are pinned, before running the loader", async () => {
      const t = setup();
      const pinned = [];
      for (let i = 0; i < 8; i++) pinned.push(await t.acquire(t.scope(`p${i}`), t.load(1)));
      let called = false;
      const e = await rejection(
        t.acquire(t.scope("n"), () => ((called = true), Promise.resolve(fakeBlob(1))))
      );
      expect(codeOf(e)).toBe("capacity_exhausted");
      expect(called).toBe(false);
      expect(t.revoked).toEqual([]);
      expect(t.cache.getStats().entries).toBe(8);
      pinned[0].release();
      (await t.acquire(t.scope("n"), t.load(1))).release();
      expect(t.revoked).toEqual([pinned[0].url]);
    });

    it("rejects without evicting or exceeding bytes when pinned bytes block the new entry", async () => {
      const t = setup();
      const pinned = [];
      for (let i = 0; i < 4; i++) pinned.push(await t.acquire(t.scope(`p${i}`), t.load(16 * MIB)));
      const unpinned = await t.acquire(t.scope("tiny"), t.load(0));
      unpinned.release();
      const e = await rejection(t.acquire(t.scope("n"), t.load(1)));
      expect(codeOf(e)).toBe("capacity_exhausted");
      expect(t.created).toHaveLength(5);
      expect(t.revoked).toEqual([]);
      expect(t.cache.getStats().totalBytes).toBe(64 * MIB);
    });
  });

  describe("concurrency queue", () => {
    it("runs max 2 loads, extra requests wait FIFO", async () => {
      const t = setup();
      const started: string[] = [];
      const ds = new Map<string, Deferred>();
      const mk = (id: string) => () => {
        started.push(id);
        const d = deferred();
        ds.set(id, d);
        return d.promise;
      };
      const ps = ["a", "b", "c", "d"].map((id) => t.acquire(t.scope(id), mk(id)));
      await flush();
      expect(started).toEqual(["a", "b"]);
      expect(t.cache.getStats()).toMatchObject({ inFlight: 2, queued: 2 });
      ds.get("b")!.resolve(1);
      await flush();
      expect(started).toEqual(["a", "b", "c"]);
      ds.get("a")!.resolve(1);
      await flush();
      expect(started).toEqual(["a", "b", "c", "d"]);
      ds.get("c")!.resolve(1);
      ds.get("d")!.resolve(1);
      (await Promise.all(ps)).forEach((l) => l.release());
      expect(t.cache.getStats()).toMatchObject({ inFlight: 0, queued: 0, entries: 4 });
    });

    it("abort while queued rejects, never starts the loader and does not leak a slot", async () => {
      const t = setup();
      const da = deferred();
      const db = deferred();
      const pa = t.acquire(t.scope("a"), () => da.promise);
      const pb = t.acquire(t.scope("b"), () => db.promise);
      const ac = new AbortController();
      let cStarted = false;
      const pc = t.acquire(t.scope("c"), () => ((cStarted = true), Promise.resolve(fakeBlob(1))), {
        signal: ac.signal,
      });
      let dStarted = false;
      const pd = t.acquire(t.scope("d"), () => ((dStarted = true), Promise.resolve(fakeBlob(1))));
      await flush();
      expect(t.cache.getStats().queued).toBe(2);
      ac.abort();
      expect(codeOf(await rejection(pc))).toBe("aborted");
      expect(t.cache.getStats().queued).toBe(1);
      da.resolve(1);
      await flush();
      expect(cStarted).toBe(false);
      expect(dStarted).toBe(true);
      db.resolve(1);
      (await Promise.all([pa, pb, pd])).forEach((l) => l.release());
      expect(t.cache.getStats()).toMatchObject({ inFlight: 0, queued: 0 });
    });

    it("aborts the loader signal only when every sharer aborted", async () => {
      const t = setup();
      let loaderSignal!: AbortSignal;
      const d = deferred();
      const loader = (s: AbortSignal) => ((loaderSignal = s), d.promise);
      const a1 = new AbortController();
      const a2 = new AbortController();
      const p1 = t.acquire(t.scope("a"), loader, { signal: a1.signal });
      const p2 = t.acquire(t.scope("a"), loader, { signal: a2.signal });
      await flush();
      a1.abort();
      expect(codeOf(await rejection(p1))).toBe("aborted");
      expect(loaderSignal.aborted).toBe(false);
      a2.abort();
      expect(codeOf(await rejection(p2))).toBe("aborted");
      expect(loaderSignal.aborted).toBe(true);
      d.resolve(5);
      await flush();
      expect(t.created).toEqual([]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, inFlight: 0 });
    });

    it("rejects immediately for pre-aborted signal and stale scope", async () => {
      const t = setup();
      const ac = new AbortController();
      ac.abort();
      expect(
        codeOf(await rejection(t.acquire(t.scope("a"), t.load(1), { signal: ac.signal })))
      ).toBe("aborted");
      expect(codeOf(await rejection(t.acquire(t.scope("a", { accessEpoch: 0 }), t.load(1))))).toBe(
        "stale_scope"
      );
    });

    it("propagates loader errors unchanged and allows retry", async () => {
      const t = setup();
      const boom = new Error("integrity");
      expect(await rejection(t.acquire(t.scope("a"), () => Promise.reject(boom)))).toBe(boom);
      expect(t.cache.getStats()).toMatchObject({ inFlight: 0, entries: 0 });
      (await t.acquire(t.scope("a"), t.load(1))).release();
      expect(t.created).toHaveLength(1);
    });
  });

  describe("scope fencing and invalidation", () => {
    it("invalidation during an in-flight load discards the result without a URL", async () => {
      const t = setup();
      const d = deferred();
      let signal!: AbortSignal;
      const p = t.acquire(t.scope("a"), (s) => ((signal = s), d.promise));
      await flush();
      t.cache.invalidateAll();
      expect(signal.aborted).toBe(true);
      expect(codeOf(await rejection(p))).toBe("invalidated");
      d.resolve(10);
      await flush();
      expect(t.created).toEqual([]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, totalBytes: 0, inFlight: 0 });
    });

    it("invalidating a queued load rejects it", async () => {
      const t = setup();
      const d1 = deferred();
      const d2 = deferred();
      void t.acquire(t.scope("a"), () => d1.promise).catch(() => undefined);
      void t.acquire(t.scope("b"), () => d2.promise).catch(() => undefined);
      const pc = t.acquire(t.scope("c"), t.load(1));
      await flush();
      t.cache.invalidateScope({ artifactIds: ["c"] });
      expect(codeOf(await rejection(pc))).toBe("invalidated");
      expect(t.cache.getStats().queued).toBe(0);
      d1.resolve(1);
      d2.resolve(1);
      await flush();
    });

    it.each([
      ["access epoch", { accessEpoch: 2 }],
      ["daemon url", { daemonUrl: "http://other" }],
    ])("%s change after the loader await drops the result", async (_n, change) => {
      const t = setup();
      const d = deferred();
      const p = t.acquire(t.scope("a"), () => d.promise);
      await flush();
      Object.assign(t.current, change);
      d.resolve(10);
      expect(codeOf(await rejection(p))).toBe("stale_scope");
      expect(t.created).toEqual([]);
      expect(t.cache.getStats().entries).toBe(0);
    });

    it("scope change while queued drops the load before the loader runs", async () => {
      const t = setup();
      const d1 = deferred();
      const d2 = deferred();
      void t.acquire(t.scope("a"), () => d1.promise).catch(() => undefined);
      void t.acquire(t.scope("b"), () => d2.promise).catch(() => undefined);
      let called = false;
      const pc = t.acquire(t.scope("c"), () => ((called = true), Promise.resolve(fakeBlob(1))));
      await flush();
      t.current.accessEpoch = 2;
      d1.resolve(1);
      expect(codeOf(await rejection(pc))).toBe("stale_scope");
      expect(called).toBe(false);
      d2.resolve(1);
      await flush();
      expect(t.created).toEqual([]);
    });

    it("invalidation revokes in-use URLs immediately exactly once and notifies views", async () => {
      const t = setup();
      const events: ArtifactBlobRevokedEvent[] = [];
      t.cache.subscribe((e) => events.push(e));
      const lease = await t.acquire(t.scope("a"), t.load(7));
      let notified = 0;
      lease.onRevoked(() => notified++);
      t.cache.invalidateAll();
      expect(t.revoked).toEqual([lease.url]);
      expect(lease.revoked).toBe(true);
      expect(notified).toBe(1);
      expect(events).toEqual([{ key: lease.key, scope: t.scope("a"), reason: "invalidated" }]);
      lease.release();
      lease.release();
      t.cache.invalidateAll();
      expect(t.revoked).toEqual([lease.url]);
      expect(t.cache.getStats()).toMatchObject({ entries: 0, totalBytes: 0 });
      let late = 0;
      lease.onRevoked(() => late++);
      expect(late).toBe(1);
    });

    it("invalidateScope / markDenied only affect matching entries", async () => {
      const t = setup();
      const a = await t.acquire(t.scope("a"), t.load(1));
      const b = await t.acquire(t.scope("b"), t.load(1));
      const c = await t.acquire(t.scope("c", { runId: "r2" }), t.load(1));
      const d = await t.acquire(t.scope("d", { sessionId: "s2" }), t.load(1));
      expect(t.cache.invalidateScope({ sessionId: "s1", runId: "r1", artifactIds: ["a"] })).toEqual(
        { revoked: 1, cancelled: 0 }
      );
      expect(t.revoked).toEqual([a.url]);
      t.cache.markDenied("s1", "r1");
      expect(t.revoked).toEqual([a.url, b.url]);
      expect(t.cache.isLeaseValid(c.key)).toBe(true);
      expect(t.cache.isLeaseValid(d.key)).toBe(true);
      t.cache.invalidateScope({ sessionId: "s2" });
      expect(t.revoked).toEqual([a.url, b.url, d.url]);
    });

    it("isolates faults in revoke listeners", async () => {
      const t = setup();
      t.cache.subscribe(() => {
        throw new Error("listener fault");
      });
      const a = await t.acquire(t.scope("a"), t.load(1));
      const b = await t.acquire(t.scope("b"), t.load(1));
      a.onRevoked(() => {
        throw new Error("lease fault");
      });
      t.cache.invalidateAll();
      expect(t.revoked).toEqual([a.url, b.url]);
    });
  });

  afterEach(() => disposeArtifactBlobCache());
});
