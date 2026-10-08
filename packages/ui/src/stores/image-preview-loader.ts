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
  ARTIFACT_PREVIEW_LEASE_MS,
  ArtifactBlobCacheError,
  createDefaultArtifactBlobCacheDeps,
  getArtifactBlobCache,
  type ArtifactBlobLease,
} from "./artifact-blob-cache.js";
import { useImageArtifactStore } from "./image-artifact-store.js";

export type ImagePreviewErrorCode =
  | "unavailable"
  | "unsupported"
  | "authorization_stale"
  | "denied"
  | "busy"
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
        return new ImagePreviewError("busy");
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

/**
 * Acquire an object-URL lease for a committed artifact. The caller owns `release()` and must
 * check `isLeaseUsable` before (re)rendering. Rejects with `ImagePreviewError` only.
 */
export async function loadImagePreview(
  artifact: ImageArtifactRef,
  { signal }: { signal?: AbortSignal } = {}
): Promise<ArtifactBlobLease> {
  if (artifact.state !== "committed") throw new ImagePreviewError("unavailable");
  if (signal?.aborted) throw new ImagePreviewError("aborted");

  const cache = getArtifactBlobCache();
  // Revoke expired URLs physically before anything can be redisplayed.
  cache.expireStale();

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

  const request = toArtifactBytesRequest(artifact);
  let lease: ArtifactBlobLease;
  try {
    lease = await cache.acquire(
      { ...currentScope(), sessionId, runId, artifactId: artifact.artifact_id },
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
  if (signal?.aborted || !isLeaseUsable(lease)) {
    lease.release();
    if (signal?.aborted) throw new ImagePreviewError("aborted");
    triggerSessionRefresh(sessionId);
    throw new ImagePreviewError("authorization_stale");
  }
  return lease;
}
