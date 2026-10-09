import * as React from "react";
import { Download, ImageOff, RotateCw } from "lucide-react";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import type { ArtifactBlobLease } from "../../stores/artifact-blob-cache.js";
import type { ImagePreviewErrorCode } from "../../stores/image-preview-loader.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import {
  IMAGE_DOWNLOAD_ERROR_MESSAGES,
  IMAGE_PREVIEW_ERROR_MESSAGES,
} from "./image-ui-messages.js";

export type PreviewFailure = "unavailable" | "denied" | "busy" | "capacity" | "failed";

export type PreviewView =
  /** Not in (or near) the viewport: nothing is loaded and no lease is held. */
  | { kind: "idle" }
  | { kind: "loading" }
  /** Visible but waiting its turn for a free preview slot; renders on its own once admitted. */
  | { kind: "queued" }
  | { kind: "ready"; lease: ArtifactBlobLease }
  /** Waiting for a newer listing stamp than `stampAtStart` (the store refresh was already requested). */
  | { kind: "refreshing"; stampAtStart: number | undefined }
  | { kind: "expired" }
  | { kind: "unsupported" }
  | { kind: "failed"; code: PreviewFailure };

/** What the view renders: a `ready` lease is only ever shown through `imageUrl`. */
export type ShownPreview = Exclude<PreviewView, { kind: "ready" }>;

export interface DownloadState {
  running: boolean;
  error: ImagePreviewErrorCode | null;
}

export interface ImageAttachmentViewProps {
  artifact: ImageArtifactRef;
  /** Zero-based position inside its group. */
  index: number;
  /** Number of images in the group (for accessible names). */
  count: number;
  figureRef: React.Ref<HTMLElement>;
  /** Object URL of a usable lease; when set the image is displayed. */
  imageUrl: string | null;
  shown: ShownPreview;
  download: DownloadState;
  onDownload: () => void;
  onReload: () => void;
}

/** Failures the user can retry by hand (capacity/busy/failed); the rest are final. */
const RELOADABLE_FAILURES: Record<PreviewFailure, boolean> = {
  unavailable: false,
  denied: false,
  busy: true,
  capacity: true,
  failed: true,
};

/** Pure presentation of one image slot: placeholder/notice/`<img>` plus the Download action. */
export function ImageAttachmentView({
  artifact,
  index,
  count,
  figureRef,
  imageUrl,
  shown,
  download,
  onDownload,
  onReload,
}: ImageAttachmentViewProps) {
  const label = `Generated image ${index + 1} of ${count}`;
  const committed = artifact.state === "committed";
  const busy = committed && (shown.kind === "loading" || shown.kind === "refreshing");

  let body: React.ReactNode;
  if (!committed) {
    body = <Notice message={IMAGE_PREVIEW_ERROR_MESSAGES.unavailable} />;
  } else if (imageUrl !== null) {
    body = (
      <img
        src={imageUrl}
        alt={label}
        width={artifact.width}
        height={artifact.height}
        className="h-full w-full object-contain"
        draggable={false}
      />
    );
  } else if (shown.kind === "idle") {
    body = null;
  } else if (shown.kind === "loading") {
    body = (
      <div role="status" className="flex h-full w-full items-center justify-center">
        <Spinner size="sm" aria-hidden="true" />
        <span className="sr-only">Loading image</span>
      </div>
    );
  } else if (shown.kind === "queued") {
    // No Reload: it would only cancel the queue position; admission is automatic.
    body = <Notice message={IMAGE_PREVIEW_ERROR_MESSAGES.capacity} role="status" spinner />;
  } else if (shown.kind === "refreshing") {
    body = <Notice message="Refreshing image access…" role="status" spinner onReload={onReload} />;
  } else if (shown.kind === "expired") {
    body = <Notice message="This image preview expired." role="status" onReload={onReload} />;
  } else if (shown.kind === "unsupported") {
    body = <Notice message={IMAGE_PREVIEW_ERROR_MESSAGES.unsupported} />;
  } else {
    body = (
      <Notice
        message={IMAGE_PREVIEW_ERROR_MESSAGES[shown.code]}
        role={shown.code === "failed" || shown.code === "denied" ? "alert" : "status"}
        onReload={RELOADABLE_FAILURES[shown.code] ? onReload : undefined}
      />
    );
  }

  return (
    <figure
      ref={figureRef}
      // The `<img alt>` names the image; the figure is named only while no image is shown, so
      // the position stays announced for placeholders and notices without double announcement.
      aria-label={imageUrl === null ? label : undefined}
      aria-busy={busy}
      tabIndex={-1}
      className="focus-visible:ring-ring m-0 w-full rounded-md focus-visible:outline-none focus-visible:ring-2"
      style={{ maxWidth: `min(100%, ${artifact.width}px)` }}
    >
      <div
        className="bg-muted/40 border-border overflow-hidden rounded-md border"
        style={{ aspectRatio: `${artifact.width} / ${artifact.height}` }}
      >
        {body}
      </div>
      {committed && (
        <figcaption className="mt-1 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Download image ${index + 1} of ${count}`}
            aria-busy={download.running}
            // aria-disabled (not `disabled`) keeps keyboard focus on the button while it runs;
            // `onDownload` is single-flight, so a repeated activation is inert.
            aria-disabled={download.running}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={onDownload}
          >
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Download
          </Button>
          {download.error !== null && (
            <p role="alert" className="text-destructive text-xs">
              {IMAGE_DOWNLOAD_ERROR_MESSAGES[download.error]}
            </p>
          )}
        </figcaption>
      )}
    </figure>
  );
}

ImageAttachmentView.displayName = "ImageAttachmentView";

function Notice({
  message,
  role,
  spinner,
  onReload,
}: {
  message: string;
  role?: "status" | "alert";
  spinner?: boolean;
  onReload?: () => void;
}) {
  return (
    <div
      role={role}
      className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-xs"
    >
      {spinner ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : (
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      )}
      <p>{message}</p>
      {onReload && (
        <Button type="button" variant="outline" size="sm" onClick={onReload}>
          <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Reload
        </Button>
      )}
    </div>
  );
}
