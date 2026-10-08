/**
 * Image artifact download: always a fresh authenticated `disposition=attachment` GET through the
 * artifact adapter (never served from the preview cache), saved via a transient object URL that is
 * revoked right after the click. Nothing is persisted or retained.
 */
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import { getArtifactService } from "../adapters/factory/ServiceFactory.js";
import { getArtifactBlobCache } from "./artifact-blob-cache.js";
import {
  currentScope,
  ImagePreviewError,
  toArtifactBytesRequest,
  toImagePreviewError,
} from "./image-preview-loader.js";

/**
 * Save `blob` as `filename` through a hidden anchor. The object URL is revoked on the next
 * macrotask (after the browser has started the download), or immediately if the click throws.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download one committed artifact. Rejects with `ImagePreviewError` only (`denied` also drops the
 * session/run from the preview cache).
 *
 * Scope fence: the daemon URL + access epoch are captured before the request and re-checked once
 * the bytes arrive, synchronously before any object URL/anchor exists (there is no await between
 * that check and `triggerBlobDownload`, so one check covers both points). A changed scope or an
 * abort discards the blob and rejects `aborted` — also for an access change, so the UI never
 * implies a server-side denial.
 */
export async function downloadImageArtifact(
  artifact: ImageArtifactRef,
  { signal }: { signal?: AbortSignal } = {}
): Promise<void> {
  if (artifact.state !== "committed") throw new ImagePreviewError("unavailable");
  if (signal?.aborted) throw new ImagePreviewError("aborted");
  // Obligation: expired preview URLs are revoked before any download proceeds.
  getArtifactBlobCache().expireStale();
  const scope = currentScope();
  try {
    const { blob, filename } = await getArtifactService().downloadArtifact(
      toArtifactBytesRequest(artifact),
      { signal }
    );
    const now = currentScope();
    if (
      signal?.aborted ||
      now.daemonUrl !== scope.daemonUrl ||
      now.accessEpoch !== scope.accessEpoch
    ) {
      throw new ImagePreviewError("aborted");
    }
    triggerBlobDownload(blob, filename);
  } catch (error) {
    throw toImagePreviewError(error, artifact, signal);
  }
}
