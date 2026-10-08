/** Types, constants, key builder and default deps for ArtifactBlobCache (see artifact-blob-cache.ts). */
import {
  getServiceAccessContext,
  registerAccessInvalidationListener,
} from "../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "./connectionStore.js";

export const ARTIFACT_CACHE_MAX_ENTRIES = 8;
export const ARTIFACT_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const ARTIFACT_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_CACHE_MAX_CONCURRENT_LOADS = 2;
export const ARTIFACT_PREVIEW_LEASE_MS = 30_000;

export interface ArtifactBlobScope {
  daemonUrl: string;
  accessEpoch: number;
  sessionId: string;
  runId: string;
  artifactId: string;
}

export type ArtifactBlobCurrentScope = Pick<ArtifactBlobScope, "daemonUrl" | "accessEpoch">;
/** Loader MUST already have verified bytes (type/size/PNG/IHDR/sha256). */
export type ArtifactBlobLoader = (signal: AbortSignal) => Promise<Blob>;

export interface ArtifactBlobAcquireOptions {
  signal?: AbortSignal;
  /**
   * REQUIRED. Monotonic ms (same clock as the cache `now`, see `ArtifactBlobCache.nowMs()`) of
   * the successful exact-scope listing that authorized/included this artifact. The 30 s preview
   * lease is anchored here, not at the acquire call. Values from the future are clamped to now;
   * non-finite or >= 30 s old values are rejected with `lease_expired` before any load.
   */
  authorizedAtMs: number;
}

export type ArtifactBlobCacheErrorCode =
  | "aborted"
  | "stale_scope"
  | "invalidated"
  | "entry_too_large"
  | "capacity_exhausted"
  | "lease_expired"
  | "disposed";

export class ArtifactBlobCacheError extends Error {
  constructor(readonly code: ArtifactBlobCacheErrorCode) {
    super(`artifact_blob_cache_${code}`);
    this.name = "ArtifactBlobCacheError";
  }
}

export type ArtifactBlobRevokeReason =
  | "evicted"
  | "invalidated"
  | "expired"
  | "stale_scope"
  | "disposed";
export interface ArtifactBlobRevokedEvent {
  key: string;
  scope: ArtifactBlobScope;
  reason: ArtifactBlobRevokeReason;
}

export interface ArtifactBlobLease {
  readonly key: string;
  readonly url: string;
  /** True once the underlying object URL was revoked (invalidation/expiry). Do not use `url` then. */
  readonly revoked: boolean;
  /** Called when the URL is revoked while leased. Invoked immediately if already revoked. */
  onRevoked(callback: () => void): () => void;
  /** Idempotent. */
  release(): void;
}

export interface ArtifactBlobScopeFilter {
  sessionId?: string;
  runId?: string;
  artifactIds?: Iterable<string>;
}

export interface ArtifactBlobCacheStats {
  entries: number;
  totalBytes: number;
  inFlight: number;
  queued: number;
}

export interface ConnectionSnapshot {
  url: string;
  status: string;
}

export interface ArtifactBlobCacheDeps {
  now: () => number;
  /** Injectable one-shot timer (per-load lease deadline). Handle is opaque. */
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (handle: unknown) => void;
  getCurrentScope: () => ArtifactBlobCurrentScope;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  subscribeAccessInvalidation: (listener: () => void) => () => void;
  subscribeConnection: (
    listener: (next: ConnectionSnapshot, prev: ConnectionSnapshot) => void
  ) => () => void;
}

export function buildArtifactBlobKey(scope: ArtifactBlobScope): string {
  // encodeURIComponent escapes ":" so the "::" separator is unambiguous.
  return [
    encodeURIComponent(scope.daemonUrl),
    String(scope.accessEpoch),
    encodeURIComponent(scope.sessionId),
    encodeURIComponent(scope.runId),
    encodeURIComponent(scope.artifactId),
  ].join("::");
}

export interface CacheEntry {
  key: string;
  scope: ArtifactBlobScope;
  url: string;
  size: number;
  refs: number;
  authorizedAtMs: number;
  revoked: boolean;
  listeners: Set<() => void>;
}

export interface LoadWaiter {
  signal?: AbortSignal;
  onAbort: () => void;
  resolve: (lease: ArtifactBlobLease) => void;
  reject: (error: unknown) => void;
}

export interface PendingLoad {
  key: string;
  scope: ArtifactBlobScope;
  /** Listing anchor (max over sharers). Lease deadline = anchor + ARTIFACT_PREVIEW_LEASE_MS. */
  authorizedAtMs: number;
  controller: AbortController;
  waiters: Set<LoadWaiter>;
  dead?: ArtifactBlobCacheError;
  settled: boolean;
  /** Lease-deadline timer handle; armed while queued or running, cleared on settle. */
  timer?: unknown;
}

export const createDefaultArtifactBlobCacheDeps = (): ArtifactBlobCacheDeps => ({
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as number),
  getCurrentScope: () => ({
    daemonUrl: useConnectionStore.getState().url ?? "",
    accessEpoch: getServiceAccessContext().accessRevision ?? 0,
  }),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  subscribeAccessInvalidation: (listener) => registerAccessInvalidationListener(() => listener()),
  subscribeConnection: (listener) =>
    useConnectionStore.subscribe((next, prev) =>
      listener({ url: next.url, status: next.status }, { url: prev.url, status: prev.status })
    ),
});

export function matchesArtifactScopeFilter(
  scope: ArtifactBlobScope,
  filter: ArtifactBlobScopeFilter,
  ids?: Set<string>
): boolean {
  if (filter.sessionId !== undefined && scope.sessionId !== filter.sessionId) return false;
  if (filter.runId !== undefined && scope.runId !== filter.runId) return false;
  if (ids && !ids.has(scope.artifactId)) return false;
  return true;
}

/**
 * Plan LRU evictions of unpinned entries so a `size`-byte entry fits the count/byte bounds.
 * Returns null (evicting nothing) when pinned entries make it impossible.
 */
export function planArtifactEvictions(
  entries: ReadonlyMap<string, CacheEntry>,
  totalBytes: number,
  size: number
): CacheEntry[] | null {
  const plan: CacheEntry[] = [];
  let count = entries.size;
  let bytes = totalBytes;
  for (const e of entries.values()) {
    if (count < ARTIFACT_CACHE_MAX_ENTRIES && bytes + size <= ARTIFACT_CACHE_MAX_TOTAL_BYTES) break;
    if (e.refs > 0) continue;
    plan.push(e);
    count--;
    bytes -= e.size;
  }
  return count >= ARTIFACT_CACHE_MAX_ENTRIES || bytes + size > ARTIFACT_CACHE_MAX_TOTAL_BYTES
    ? null
    : plan;
}

/** Ref-counted lease on an entry; `release` is idempotent and revocation listeners are per lease. */
export function createArtifactBlobLease(entry: CacheEntry): ArtifactBlobLease {
  entry.refs++;
  let released = false;
  const offs = new Set<() => void>();
  return {
    key: entry.key,
    url: entry.url,
    get revoked() {
      return entry.revoked;
    },
    onRevoked: (callback) => {
      if (entry.revoked) {
        callback();
        return () => undefined;
      }
      entry.listeners.add(callback);
      offs.add(callback);
      return () => {
        entry.listeners.delete(callback);
        offs.delete(callback);
      };
    },
    release: () => {
      if (released) return;
      released = true;
      for (const cb of offs) entry.listeners.delete(cb);
      offs.clear();
      if (!entry.revoked) entry.refs--;
    },
  };
}

/**
 * FIFO concurrency gate for ArtifactBlobCache loads.
 *
 * A slot is held from `request()` resolution until the caller invokes `release()`, which the cache
 * does only after the loader promise has actually SETTLED. A loader that ignores its abort signal
 * therefore keeps counting as active, so the number of concurrently running loaders never exceeds
 * `limit` even after the lease deadline aborted/rejected the logical load.
 */
interface QueuedRequest<T> {
  item: T;
  grant: () => void;
  fail: (error: unknown) => void;
}

export class LoadSlotQueue<T extends object> {
  private activeCount = 0;
  private readonly waiting: Array<QueuedRequest<T>> = [];

  constructor(private readonly limit: number) {}

  get active(): number {
    return this.activeCount;
  }

  get queued(): number {
    return this.waiting.length;
  }

  /** Resolves once a slot is held for `item`. The caller MUST call `release()` exactly once afterwards. */
  request(item: T): Promise<void> {
    if (this.activeCount < this.limit && this.waiting.length === 0) {
      this.activeCount++;
      return Promise.resolve();
    }
    return new Promise<void>((grant, fail) => {
      this.waiting.push({ item, grant, fail });
    });
  }

  /** Remove a still-queued item and reject its pending `request()`. No-op once granted. */
  cancel(item: T, error: unknown): void {
    const index = this.waiting.findIndex((w) => w.item === item);
    if (index < 0) return;
    const [removed] = this.waiting.splice(index, 1);
    removed.fail(error);
  }

  release(): void {
    this.activeCount--;
    while (this.activeCount < this.limit && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.activeCount++;
      next.grant();
    }
  }
}
