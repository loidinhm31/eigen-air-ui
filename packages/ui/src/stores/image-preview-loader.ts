/**
 * Authorized preview loader for committed image artifacts.
 *
 * `loadImagePreview` is the only path that turns artifact metadata into a displayable object URL:
 *   1. only `committed` artifacts load;
 *   2. the exact-scope listing stamp (image store, cache clock) must be < 30 s old, otherwise a
 *      session refresh is triggered and `authorization_stale` is thrown (retry after it lands);
 *   3. bytes come from the verified adapter GET through the memory-only `ArtifactBlobCache`,
 *      with the lease anchored at the listing stamp (never at the acquire time).
 *
 * Errors are mapped to a small UI-safe enum; response/error text is never echoed.
 */
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import { getArtifactService } from "../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type ArtifactBytesRequest,
} from "../adapters/factory/interfaces/IArtifactAdapter.js";
import {
  ARTIFACT_CACHE_MAX_ENTRIES,
  ARTIFACT_PREVIEW_LEASE_MS,
  ArtifactBlobCacheError,
  createDefaultArtifactBlobCacheDeps,
  getArtifactBlobCache,
  type ArtifactBlobCache,
  type ArtifactBlobLease,
} from "./artifact-blob-cache.js";
import { useImageArtifactStore } from "./image-artifact-store.js";

export type ImagePreviewErrorCode =
  | "unavailable"
  | "unsupported"
  | "authorization_stale"
  | "denied"
  | "busy"
  /** Every cache slot is pinned by another live preview (recoverable when one is released). */
  | "capacity"
  | "failed"
  | "aborted";

/** Typed, text-free error: `message` is always `image_preview_<code>`. */
export class ImagePreviewError extends Error {
  readonly code: ImagePreviewErrorCode;
  constructor(code: ImagePreviewErrorCode) {
    super(`image_preview_${code}`);
    this.name = "ImagePreviewError";
    this.code = code;
  }
}

// Same daemon URL + access epoch sources the cache fences on (single definition, no duplicate).
export const currentScope = createDefaultArtifactBlobCacheDeps().getCurrentScope;

/** Bytes request from listing metadata (all fields are verified by the adapter). */
export function toArtifactBytesRequest(artifact: ImageArtifactRef): ArtifactBytesRequest {
  return {
    artifactId: artifact.artifact_id,
    sessionId: artifact.session_id,
    runId: artifact.run_id,
    byteSize: artifact.byte_size,
    sha256: artifact.sha256,
    width: artifact.width,
    height: artifact.height,
  };
}

/**
 * Capacity-gated admission. A preview needs one slot (distinct artifact) from the moment it is
 * admitted until its lease is released or revoked. At most `capacityOverride ??
 * ARTIFACT_CACHE_MAX_ENTRIES` slots exist (the cache's entry bound, so an admitted load can never
 * meet a fully pinned pool). Callers that find no free slot wait in a FIFO queue; every freed slot
 * admits exactly the next waiter(s) that fit, so nothing is retried, nothing is woken needlessly
 * and no retry budget is spent while merely waiting. Waiting is abortable (offscreen / unmount)
 * and holds nothing. A key that is already held (a second view of one artifact) shares its slot.
 */
interface Waiter {
  key: string;
  admit: () => void;
}
interface Admission {
  holders: Map<string, number>;
  queue: Waiter[];
}
/** One state per cache instance: a replaced cache (tests) starts with no holders or waiters. */
const admissions = new WeakMap<ArtifactBlobCache, Admission>();
let capacityOverride: number | undefined;

/** Test seam: bound the number of simultaneously leased previews (`undefined` = cache bound). */
export function setPreviewAdmissionCapacity(capacity: number | undefined): void {
  capacityOverride = capacity;
  pumpAdmission(admissionFor(getArtifactBlobCache()));
}

function admissionFor(cache: ArtifactBlobCache): Admission {
  let admission = admissions.get(cache);
  if (!admission) {
    admission = { holders: new Map(), queue: [] };
    admissions.set(cache, admission);
  }
  return admission;
}

function canAdmit(admission: Admission, key: string): boolean {
  const capacity = capacityOverride ?? ARTIFACT_CACHE_MAX_ENTRIES;
  return admission.holders.has(key) || admission.holders.size < capacity;
}

function reserveSlot(admission: Admission, key: string): void {
  admission.holders.set(key, (admission.holders.get(key) ?? 0) + 1);
}

/** Admit queued waiters, in order, while they fit (one new artifact per freed slot). */
function pumpAdmission(admission: Admission): void {
  for (let i = 0; i < admission.queue.length; ) {
    const waiter = admission.queue[i]!;
    if (!canAdmit(admission, waiter.key)) {
      i += 1;
      continue;
    }
    admission.queue.splice(i, 1);
    reserveSlot(admission, waiter.key);
    waiter.admit();
  }
}

function freeSlot(admission: Admission, key: string): void {
  const held = admission.holders.get(key) ?? 0;
  if (held <= 1) admission.holders.delete(key);
  else admission.holders.set(key, held - 1);
  pumpAdmission(admission);
}

/**
 * Reserve a slot, waiting FIFO when none is free. `onQueueChange(true)` fires synchronously when
 * the caller starts to wait, `(false)` once admitted. Rejects `aborted` (queue entry removed,
 * nothing reserved) when `signal` fires while waiting. Resolves whether it had to wait.
 */
async function admit(
  admission: Admission,
  key: string,
  signal: AbortSignal | undefined,
  onQueueChange: ((queued: boolean) => void) | undefined
): Promise<boolean> {
  if (canAdmit(admission, key)) {
    reserveSlot(admission, key);
    return false;
  }
  onQueueChange?.(true);
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      key,
      admit: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
    };
    const onAbort = () => {
      const at = admission.queue.indexOf(waiter);
      if (at >= 0) admission.queue.splice(at, 1);
      reject(new ImagePreviewError("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    admission.queue.push(waiter);
  });
  onQueueChange?.(false);
  return true;
}

/**
 * Same lease, but the admission slot is freed by its first release OR revocation (the entry left
 * the cache either way). Idempotent; the caller must not free the slot separately afterwards.
 */
function holdSlotWhileLeased(
  lease: ArtifactBlobLease,
  admission: Admission,
  key: string
): ArtifactBlobLease {
  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    freeSlot(admission, key);
  };
  const offRevoked = lease.onRevoked(free);
  let released = false;
  return {
    key: lease.key,
    url: lease.url,
    get revoked() {
      return lease.revoked;
    },
    onRevoked: (callback) => lease.onRevoked(callback),
    release: () => {
      if (released) return;
      released = true;
      offRevoked();
      lease.release();
      free();
    },
  };
}

/** Ask the store for a fresh exact-scope listing; the store's refresh never rejects or throws. */
function triggerSessionRefresh(sessionId: string): void {
  void useImageArtifactStore.getState().refreshSession(sessionId);
}

/**
 * Map any loader/adapter/cache failure to the UI enum. Side effect: a `denied` outcome
 * (401/403/404) immediately drops every cached URL of that session/run (`markDenied`).
 */
export function toImagePreviewError(
  error: unknown,
  artifact: ImageArtifactRef,
  signal?: AbortSignal
): ImagePreviewError {
  if (error instanceof ImagePreviewError) return error;
  if (signal?.aborted) return new ImagePreviewError("aborted");
  if (error instanceof ArtifactBlobCacheError) {
    switch (error.code) {
      case "aborted":
      case "stale_scope":
      case "invalidated":
      case "disposed":
        // Scope changed or caller left: nothing may be shown, and it is not an error to display.
        return new ImagePreviewError("aborted");
      case "lease_expired":
        return new ImagePreviewError("authorization_stale");
      case "capacity_exhausted":
        // Every cache slot is pinned by a live preview: recoverable once any lease is released.
        return new ImagePreviewError("capacity");
      default:
        return new ImagePreviewError("failed");
    }
  }
  if (error instanceof ArtifactAdapterError) {
    switch (error.kind) {
      case "aborted":
        return new ImagePreviewError("aborted");
      case "unsupported":
        return new ImagePreviewError("unsupported");
      case "unauthorized":
      case "not_found":
        getArtifactBlobCache().markDenied(artifact.session_id, artifact.run_id);
        return new ImagePreviewError("denied");
      case "unavailable":
        return new ImagePreviewError(
          error.code === "image_busy" || error.code === "image_resource_unavailable"
            ? "busy"
            : "failed"
        );
      default:
        return new ImagePreviewError("failed");
    }
  }
  return new ImagePreviewError("failed");
}

/** Lease is displayable only while its URL is live and the cache still deems it fresh. */
export function isLeaseUsable(lease: ArtifactBlobLease): boolean {
  return !lease.revoked && getArtifactBlobCache().isLeaseValid(lease.key);
}

/** Listing stamp that authorizes bytes now, else refresh the session and throw `authorization_stale`. */
function requireAuthorizedStamp(artifact: ImageArtifactRef, cache: ArtifactBlobCache): number {
  const { session_id: sessionId, run_id: runId } = artifact;
  const stamp: unknown = useImageArtifactStore.getState().listingStampFor(sessionId, runId);
  // Only an own, finite number authorizes bytes (never a prototype member / NaN / Infinity).
  if (
    typeof stamp !== "number" ||
    !Number.isFinite(stamp) ||
    cache.nowMs() - stamp >= ARTIFACT_PREVIEW_LEASE_MS
  ) {
    triggerSessionRefresh(sessionId);
    throw new ImagePreviewError("authorization_stale");
  }
  return stamp;
}

export interface LoadImagePreviewOptions {
  signal?: AbortSignal;
  /**
   * `true` (synchronously) when no preview slot is free and the load starts waiting its turn,
   * `false` once admitted. Never called again after `signal` aborted.
   */
  onQueueChange?: (queued: boolean) => void;
}

/**
 * Acquire an object-URL lease for a committed artifact. When every preview slot is leased, the
 * call waits FIFO for a freed slot (see "Capacity-gated admission"); waiting is cancelled by
 * `signal`. The caller owns `release()` and must check `isLeaseUsable` before (re)rendering.
 * Rejects with `ImagePreviewError` only.
 */
export async function loadImagePreview(
  artifact: ImageArtifactRef,
  { signal, onQueueChange }: LoadImagePreviewOptions = {}
): Promise<ArtifactBlobLease> {
  if (artifact.state !== "committed") throw new ImagePreviewError("unavailable");
  if (signal?.aborted) throw new ImagePreviewError("aborted");

  const cache = getArtifactBlobCache();
  // Revoke expired URLs physically before anything can be redisplayed.
  cache.expireStale();

  const { session_id: sessionId, run_id: runId, artifact_id: artifactId } = artifact;
  // Fail fast (no waiting for a slot that would be spent on a stale attempt).
  let stamp = requireAuthorizedStamp(artifact, cache);

  const admission = admissionFor(cache);
  const slotKey = `${sessionId}\u0000${runId}\u0000${artifactId}`;
  const waited = await admit(admission, slotKey, signal, onQueueChange);

  // From here a slot is reserved: it is handed to the lease below or freed on every other exit.
  let slotOwnedByLease = false;
  try {
    if (signal?.aborted) throw new ImagePreviewError("aborted");
    if (waited) {
      // The wait can outlast the authorization window: re-validate with the live stamp.
      cache.expireStale();
      stamp = requireAuthorizedStamp(artifact, cache);
    }

    const request = toArtifactBytesRequest(artifact);
    let lease: ArtifactBlobLease;
    try {
      lease = await cache.acquire(
        { ...currentScope(), sessionId, runId, artifactId },
        (loadSignal) =>
          getArtifactService().fetchArtifactBytes(request, {
            signal: loadSignal,
            disposition: "inline",
          }),
        { signal, authorizedAtMs: stamp }
      );
    } catch (error) {
      const mapped = toImagePreviewError(error, artifact, signal);
      if (mapped.code === "authorization_stale") triggerSessionRefresh(sessionId);
      throw mapped;
    }
    lease = holdSlotWhileLeased(lease, admission, slotKey);
    slotOwnedByLease = true;
    if (signal?.aborted || !isLeaseUsable(lease)) {
      lease.release();
      if (signal?.aborted) throw new ImagePreviewError("aborted");
      triggerSessionRefresh(sessionId);
      throw new ImagePreviewError("authorization_stale");
    }
    return lease;
  } finally {
    if (!slotOwnedByLease) freeSlot(admission, slotKey);
  }
}
