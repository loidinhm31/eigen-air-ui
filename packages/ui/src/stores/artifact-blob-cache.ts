/**
 * Memory-only, ref-counted object-URL cache for verified image artifact bytes.
 *
 * Invariants:
 * - Never persists bytes/URLs; the Blob is not retained (only the object URL, which pins it).
 * - Bounds: <= 8 entries, <= 64 MiB total, <= 16 MiB per entry, <= 2 concurrently ACTIVE loaders.
 * - LRU eviction only touches entries with refcount 0. When every entry is pinned and a new
 *   entry would exceed bounds, installation is rejected (`capacity_exhausted`).
 * - Scope fence (daemonUrl + accessEpoch) is re-checked after every await and before install.
 *   Stale/aborted/invalidated results are discarded and never create a URL or entry.
 * - Every object URL is revoked exactly once (eviction, invalidation, expiry, dispose).
 * - Preview lease: 30 s monotonic, anchored at the authorizing exact-scope listing (the caller's
 *   `authorizedAtMs`), never at the acquire call. Only `renew` (with a newer listing time)
 *   extends it; cache hits and acquire never do.
 *
 * Lazy expiry / retention (decision W6): there is NO internal expiry timer. Entries whose last
 * lease is released stay cached at refcount 0 (LRU reuse) and expired entries stay mapped until
 * something calls `acquire`/`renew`/`expireStale`/`assertFresh`. The UI layer (Slice B) MUST drive
 * `expireStale()` at <= 15 s and on visibility/focus resume so expired blobs are revoked promptly.
 *
 * Load deadline (W4): every pending load (queued or running) gets a timer at anchor + 30 s that
 * aborts its controller, rejects its waiters with `lease_expired` and drops it from the queue.
 * A loader that ignores abort still occupies its slot until its promise settles, so at most 2
 * loaders are ever active; requests queued behind it are bounded by their own lease deadlines.
 * Late results after the deadline never install.
 *
 * Separate from ChatDebugCache by design (no sharing).
 */
import {
  ARTIFACT_CACHE_MAX_CONCURRENT_LOADS,
  ARTIFACT_CACHE_MAX_ENTRIES,
  ARTIFACT_CACHE_MAX_ENTRY_BYTES,
  ARTIFACT_PREVIEW_LEASE_MS,
  ArtifactBlobCacheError,
  buildArtifactBlobKey,
  createArtifactBlobLease,
  createDefaultArtifactBlobCacheDeps,
  LoadSlotQueue,
  matchesArtifactScopeFilter,
  planArtifactEvictions,
  type ArtifactBlobAcquireOptions,
  type ArtifactBlobCacheDeps,
  type ArtifactBlobCacheStats,
  type ArtifactBlobCurrentScope,
  type ArtifactBlobLease,
  type ArtifactBlobLoader,
  type ArtifactBlobRevokeReason,
  type ArtifactBlobRevokedEvent,
  type ArtifactBlobScope,
  type ArtifactBlobScopeFilter,
  type CacheEntry,
  type LoadWaiter,
  type PendingLoad,
} from "./artifact-blob-cache-types.js";

export * from "./artifact-blob-cache-types.js";

export class ArtifactBlobCache {
  private readonly deps: ArtifactBlobCacheDeps;
  /** Insertion order == LRU order (oldest first). */
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, PendingLoad>();
  private readonly slots = new LoadSlotQueue<PendingLoad>(ARTIFACT_CACHE_MAX_CONCURRENT_LOADS);
  private readonly subscribers = new Set<(event: ArtifactBlobRevokedEvent) => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private totalBytes = 0;
  private disposed = false;

  constructor(deps: Partial<ArtifactBlobCacheDeps> = {}) {
    this.deps = { ...createDefaultArtifactBlobCacheDeps(), ...deps };
    this.unsubscribers.push(
      this.deps.subscribeAccessInvalidation(() => this.invalidateAll()),
      this.deps.subscribeConnection((next, prev) => {
        const left = prev.status === "connected" && next.status !== "connected";
        const dropped = prev.status !== next.status && next.status === "disconnected";
        if (next.url !== prev.url || left || dropped) this.invalidateAll();
      })
    );
  }

  /** Cache clock (monotonic ms). Callers MUST stamp authorizing listings with this clock. */
  nowMs(): number {
    return this.deps.now();
  }

  getStats(): ArtifactBlobCacheStats {
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      inFlight: this.slots.active,
      queued: this.slots.queued,
    };
  }

  /** Notified for every revoked entry (any reason). Returns unsubscribe. */
  subscribe(listener: (event: ArtifactBlobRevokedEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * Caller MUST hold a fresh authorized exact-scope listing for `scope` and pass its monotonic
   * time (`options.authorizedAtMs`, from `nowMs()`); an anchor >= 30 s old is rejected with
   * `lease_expired` before queueing or loading. The entry lease is anchored there, a load that
   * finishes after anchor + 30 s is dropped (`lease_expired`, no URL), and a cache hit never
   * extends the lease (use `renew`). Concurrent acquires of the same key share one load (the
   * newest sharer anchor wins); the load aborts only when all sharers abort, on invalidation or at
   * the lease deadline. Expired entries are revoked and reloaded, never served.
   */
  acquire(
    scope: ArtifactBlobScope,
    loader: ArtifactBlobLoader,
    options: ArtifactBlobAcquireOptions
  ): Promise<ArtifactBlobLease> {
    const { signal } = options;
    if (this.disposed) return Promise.reject(new ArtifactBlobCacheError("disposed"));
    if (signal?.aborted) return Promise.reject(new ArtifactBlobCacheError("aborted"));
    const anchor = this.resolveAnchor(options.authorizedAtMs);
    if (anchor === undefined) return Promise.reject(new ArtifactBlobCacheError("lease_expired"));
    if (!this.isScopeCurrent(scope))
      return Promise.reject(new ArtifactBlobCacheError("stale_scope"));

    this.expireStale();
    const key = buildArtifactBlobKey(scope);
    const hit = this.entries.get(key);
    if (hit) {
      this.touch(hit);
      return Promise.resolve(createArtifactBlobLease(hit));
    }

    let load = this.pending.get(key);
    const isNew = !load;
    if (!load) {
      load = {
        key,
        scope,
        authorizedAtMs: anchor,
        controller: new AbortController(),
        waiters: new Set(),
        settled: false,
      };
      this.pending.set(key, load);
      this.armDeadline(load);
    } else if (anchor > load.authorizedAtMs) {
      load.authorizedAtMs = anchor;
      this.armDeadline(load);
    }
    const target = load;
    const promise = new Promise<ArtifactBlobLease>((resolve, reject) => {
      const waiter: LoadWaiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          target.waiters.delete(waiter);
          reject(new ArtifactBlobCacheError("aborted"));
          if (target.waiters.size === 0)
            this.cancelPending(target, new ArtifactBlobCacheError("aborted"));
        },
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      target.waiters.add(waiter);
    });
    if (isNew) void this.executeLoad(target, loader);
    return promise;
  }

  /** Revoke + remove entries (live refs included) and abort in-flight loads matching the filter. */
  invalidateScope(filter: ArtifactBlobScopeFilter): { revoked: number; cancelled: number } {
    const ids = filter.artifactIds ? new Set(filter.artifactIds) : undefined;
    let cancelled = 0;
    for (const load of [...this.pending.values()]) {
      if (matchesArtifactScopeFilter(load.scope, filter, ids)) {
        this.cancelPending(load, new ArtifactBlobCacheError("invalidated"));
        cancelled++;
      }
    }
    let revoked = 0;
    for (const entry of [...this.entries.values()]) {
      if (matchesArtifactScopeFilter(entry.scope, filter, ids)) {
        this.revokeEntry(entry, "invalidated");
        revoked++;
      }
    }
    return { revoked, cancelled };
  }

  invalidateAll(): void {
    this.invalidateScope({});
  }

  /** 401/403/404 on an exact scope: drop everything for that session/run immediately. */
  markDenied(sessionId: string, runId: string): void {
    this.invalidateScope({ sessionId, runId });
  }

  /**
   * Refresh the lease of PRESENT entries after a successful exact-scope authorized listing taken
   * at `authorizedAtMs` (cache clock, default now). The anchor only moves forward (monotonic max;
   * an older listing never shortens a lease) and is clamped to now. Already-expired entries are
   * revoked first and are never resurrected. Returns renewed count.
   */
  renew(
    sessionId: string,
    runId: string,
    artifactIds: Iterable<string>,
    authorizedAtMs?: number
  ): number {
    this.expireStale();
    const ids = new Set(artifactIds);
    const now = this.deps.now();
    const at = Math.min(authorizedAtMs ?? now, now);
    if (!Number.isFinite(at)) return 0;
    let renewed = 0;
    for (const entry of this.entries.values()) {
      const s = entry.scope;
      if (s.sessionId === sessionId && s.runId === runId && ids.has(s.artifactId)) {
        entry.authorizedAtMs = Math.max(entry.authorizedAtMs, at);
        renewed++;
      }
    }
    return renewed;
  }

  /** Pure check: entry present, lease < 30 s old, scope still current. */
  isLeaseValid(key: string): boolean {
    const entry = this.entries.get(key);
    return !!entry && this.entryUsable(entry);
  }

  /** Fail-closed guard before render/actions: revokes the entry and throws when not fresh. */
  assertFresh(key: string): void {
    const entry = this.entries.get(key);
    if (entry && this.entryUsable(entry)) return;
    if (entry)
      this.revokeEntry(entry, this.isScopeCurrent(entry.scope) ? "expired" : "stale_scope");
    throw new ArtifactBlobCacheError("lease_expired");
  }

  /**
   * Revoke expired / stale-scope entries, zero-ref ones included. The cache has no timer of its
   * own: the UI layer MUST call this at <= 15 s intervals and on visibility/focus resume.
   */
  expireStale(): number {
    let count = 0;
    for (const entry of [...this.entries.values()]) {
      if (!this.isScopeCurrent(entry.scope)) {
        this.revokeEntry(entry, "stale_scope");
        count++;
      } else if (!this.leaseFresh(entry)) {
        this.revokeEntry(entry, "expired");
        count++;
      }
    }
    return count;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribers.splice(0)) off();
    for (const load of [...this.pending.values()]) {
      this.cancelPending(load, new ArtifactBlobCacheError("disposed"));
    }
    for (const entry of [...this.entries.values()]) this.revokeEntry(entry, "disposed");
    this.subscribers.clear();
  }

  // ---- internals ----

  /** Normalised listing anchor, or undefined when not finite / already past the lease. */
  private resolveAnchor(authorizedAtMs: number): number | undefined {
    if (!Number.isFinite(authorizedAtMs)) return undefined;
    const now = this.deps.now();
    const anchor = Math.min(authorizedAtMs, now);
    return now - anchor >= ARTIFACT_PREVIEW_LEASE_MS ? undefined : anchor;
  }

  private isScopeCurrent(scope: ArtifactBlobCurrentScope): boolean {
    const cur = this.deps.getCurrentScope();
    return cur.daemonUrl === scope.daemonUrl && cur.accessEpoch === scope.accessEpoch;
  }

  private leaseFresh(entry: CacheEntry): boolean {
    return this.deps.now() - entry.authorizedAtMs < ARTIFACT_PREVIEW_LEASE_MS;
  }

  private entryUsable(entry: CacheEntry): boolean {
    return !entry.revoked && this.isScopeCurrent(entry.scope) && this.leaseFresh(entry);
  }

  private touch(entry: CacheEntry): void {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  /** (Re)arm the lease-deadline timer: abort + `lease_expired` at anchor + 30 s. */
  private armDeadline(load: PendingLoad): void {
    this.disarmDeadline(load);
    const delay = Math.max(0, load.authorizedAtMs + ARTIFACT_PREVIEW_LEASE_MS - this.deps.now());
    load.timer = this.deps.setTimer(() => {
      load.timer = undefined;
      this.cancelPending(load, new ArtifactBlobCacheError("lease_expired"));
    }, delay);
  }

  private disarmDeadline(load: PendingLoad): void {
    if (load.timer === undefined) return;
    this.deps.clearTimer(load.timer);
    load.timer = undefined;
  }

  private async executeLoad(load: PendingLoad, loader: ArtifactBlobLoader): Promise<void> {
    let granted = false;
    try {
      this.assertCanStart();
      await this.slots.request(load);
      granted = true;
      this.assertLive(load);
      const blob = await loader(load.controller.signal);
      this.assertLive(load);
      const entry = this.install(load, blob);
      this.settle(load, (w) => w.resolve(createArtifactBlobLease(entry)));
    } catch (error) {
      this.cancelPending(load, load.dead ?? (error as ArtifactBlobCacheError), error);
    } finally {
      // Slot is freed only once the loader promise settled (even if the load was cancelled).
      if (granted) this.slots.release();
    }
  }

  /** Cheap pre-download rejection when full and fully pinned. */
  private assertCanStart(): void {
    if (this.entries.size < ARTIFACT_CACHE_MAX_ENTRIES) return;
    for (const e of this.entries.values()) if (e.refs === 0) return;
    throw new ArtifactBlobCacheError("capacity_exhausted");
  }

  /** Re-check after every await: not cancelled, scope+epoch still current. */
  private assertLive(load: PendingLoad): void {
    if (load.dead) throw load.dead;
    if (this.disposed) throw new ArtifactBlobCacheError("disposed");
    if (!this.isScopeCurrent(load.scope)) throw new ArtifactBlobCacheError("stale_scope");
  }

  private install(load: PendingLoad, blob: Blob): CacheEntry {
    const size = blob.size;
    if (size > ARTIFACT_CACHE_MAX_ENTRY_BYTES) throw new ArtifactBlobCacheError("entry_too_large");
    if (this.deps.now() - load.authorizedAtMs >= ARTIFACT_PREVIEW_LEASE_MS) {
      throw new ArtifactBlobCacheError("lease_expired");
    }

    const plan = planArtifactEvictions(this.entries, this.totalBytes, size);
    if (!plan) throw new ArtifactBlobCacheError("capacity_exhausted");
    const url = this.deps.createObjectURL(blob);
    for (const e of plan) this.revokeEntry(e, "evicted");
    const entry: CacheEntry = {
      key: load.key,
      scope: load.scope,
      url,
      size,
      refs: 0,
      authorizedAtMs: load.authorizedAtMs,
      revoked: false,
      listeners: new Set(),
    };
    this.entries.set(entry.key, entry);
    this.totalBytes += size;
    return entry;
  }

  private settle(load: PendingLoad, fn: (waiter: LoadWaiter) => void): void {
    if (load.settled) return;
    load.settled = true;
    this.disarmDeadline(load);
    if (this.pending.get(load.key) === load) this.pending.delete(load.key);
    for (const w of [...load.waiters]) {
      w.signal?.removeEventListener("abort", w.onAbort);
      load.waiters.delete(w);
      fn(w);
    }
  }

  /** Abort + fail a pending load (queued or running). Late loader results are then dropped. */
  private cancelPending(
    load: PendingLoad,
    reason: ArtifactBlobCacheError,
    rawError?: unknown
  ): void {
    if (load.settled) return;
    if (reason instanceof ArtifactBlobCacheError) load.dead ??= reason;
    load.controller.abort();
    // Loader errors (non-cache) propagate unchanged unless the load was cancelled meanwhile.
    const error = load.dead ?? rawError ?? reason;
    this.settle(load, (w) => w.reject(error));
    this.slots.cancel(load, error);
  }

  private revokeEntry(entry: CacheEntry, reason: ArtifactBlobRevokeReason): void {
    if (entry.revoked) return;
    entry.revoked = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.totalBytes -= entry.size;
    this.deps.revokeObjectURL(entry.url);
    const event: ArtifactBlobRevokedEvent = { key: entry.key, scope: entry.scope, reason };
    for (const cb of [...entry.listeners]) this.safe(cb);
    entry.listeners.clear();
    for (const sub of [...this.subscribers]) this.safe(() => sub(event));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Listener faults must not break revocation.
    }
  }
}

let singleton: ArtifactBlobCache | null = null;

/** Lazily-created app-wide cache (auto-invalidation wired to access/connection stores). */
export function getArtifactBlobCache(): ArtifactBlobCache {
  singleton ??= new ArtifactBlobCache();
  return singleton;
}

export function disposeArtifactBlobCache(): void {
  singleton?.dispose();
  singleton = null;
}
