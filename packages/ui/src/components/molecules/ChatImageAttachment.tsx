import * as React from "react";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import type { ArtifactBlobLease } from "../../stores/artifact-blob-cache.js";
import { downloadImageArtifact } from "../../stores/image-download.js";
import { useImageArtifactStore } from "../../stores/image-artifact-store.js";
import { registerImagePreview } from "../../stores/image-lease-driver.js";
import {
  ImagePreviewError,
  isLeaseUsable,
  loadImagePreview,
  type ImagePreviewErrorCode,
} from "../../stores/image-preview-loader.js";
import {
  ImageAttachmentView,
  type DownloadState,
  type PreviewView,
  type ShownPreview,
} from "./image-attachment-view.js";
import { useInViewport } from "./use-in-viewport.js";

export interface ChatImageAttachmentProps {
  artifact: ImageArtifactRef;
  /** Zero-based position inside its group. */
  index: number;
  /** Number of images in the group (for the accessible name). */
  count: number;
}

/** Automatic retries after `authorization_stale` per viewport visit; further need a Reload click. */
const MAX_AUTOMATIC_RETRIES = 2;

const IDLE: PreviewView = { kind: "idle" };
const LOADING: PreviewView = { kind: "loading" };
const QUEUED: PreviewView = { kind: "queued" };
const EXPIRED: ShownPreview = { kind: "expired" };

function errorCode(error: unknown): ImagePreviewErrorCode {
  return error instanceof ImagePreviewError ? error.code : "failed";
}

/**
 * One generated image: authorized preview (object URL from a leased cache entry) plus an
 * authenticated download. The lease is held ONLY while the image is in (or near) the viewport:
 * leaving it, any expiry, revocation, scope change or unmount aborts the load, releases the lease
 * and drops the `<img>`; re-entering loads again. This keeps the 8-entry preview cache from being
 * pinned by images nobody can see. When more previews are visible than the loader has slots for,
 * the surplus shows a `queued` notice and the loader admits them one per freed slot (no retries
 * here: waiting is the loader's job, so it cannot run out of budget). No Markdown/URL parsing, no
 * storage.
 *
 * Focus contract: a Reload button disappears when the preview reloads. If focus was inside the
 * figure (not on Download), it is parked on the figure itself (the preview) before the swap and
 * stays there, so a keyboard user is never dropped to `<body>`. Focus elsewhere (the Download
 * button, the chat input) is left alone.
 */
export function ChatImageAttachment({ artifact, index, count }: ChatImageAttachmentProps) {
  const committed = artifact.state === "committed";
  const { session_id: sessionId, run_id: runId, artifact_id: artifactId } = artifact;

  const figureRef = React.useRef<HTMLElement>(null);
  const visible = useInViewport(figureRef);
  const active = committed && visible;

  const [view, setView] = React.useState<PreviewView>(active ? LOADING : IDLE);
  const [attempt, setAttempt] = React.useState(0);
  const staleCount = React.useRef(0);
  const latestArtifact = React.useRef(artifact);
  latestArtifact.current = artifact;

  // Stamp of the listing that included this run: the signal to retry after a stale lease.
  const stamp = useImageArtifactStore((s) => s.listingStampFor(sessionId, runId));

  // Keeps the lease-expiry driver running only while a preview of this session can be displayed.
  React.useEffect(
    () => (active ? registerImagePreview(sessionId) : undefined),
    [active, sessionId]
  );

  // A new viewport visit / artifact starts a fresh stale-retry budget.
  React.useEffect(() => {
    staleCount.current = 0;
  }, [active, artifactId, sessionId, runId]);

  /**
   * The Reload button of a notice is replaced by the next state: park focus on the figure so a
   * keyboard user is not dropped to `<body>`. Focus on the Download button is left alone.
   */
  const keepFocusInFigure = React.useCallback(() => {
    const figure = figureRef.current;
    const focused = document.activeElement;
    if (figure && focused && focused !== figure && figure.contains(focused)) {
      if (!focused.closest("figcaption")) figure.focus({ preventScroll: true });
    }
  }, []);

  React.useEffect(() => {
    keepFocusInFigure();
    if (!active) {
      setView(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    const stampAtStart = useImageArtifactStore.getState().listingStampFor(sessionId, runId);
    let lease: ArtifactBlobLease | null = null;
    let offRevoked: (() => void) | undefined;
    setView(LOADING);

    loadImagePreview(latestArtifact.current, {
      signal: controller.signal,
      // Waiting for a free slot is not a failure: show it, render when the loader admits us.
      onQueueChange: (queued) => {
        if (!controller.signal.aborted) setView(queued ? QUEUED : LOADING);
      },
    }).then(
      (loaded) => {
        if (controller.signal.aborted) {
          loaded.release(); // left the viewport / unmounted meanwhile: never show, never keep
          return;
        }
        lease = loaded;
        // `ready` first: onRevoked fires synchronously when the lease is already revoked.
        setView({ kind: "ready", lease: loaded });
        offRevoked = loaded.onRevoked(() => {
          setView(EXPIRED);
          loaded.release();
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const code = errorCode(error);
        if (code === "authorization_stale") {
          staleCount.current += 1;
          setView(
            staleCount.current > MAX_AUTOMATIC_RETRIES
              ? EXPIRED
              : { kind: "refreshing", stampAtStart }
          );
        } else if (code === "unsupported") {
          setView({ kind: "unsupported" });
        } else if (code === "aborted") {
          setView(EXPIRED); // scope changed under us: show nothing, offer Reload
        } else {
          setView({ kind: "failed", code });
        }
      }
    );

    return () => {
      controller.abort();
      offRevoked?.();
      lease?.release();
    };
  }, [active, artifactId, sessionId, runId, attempt, keepFocusInFigure]);

  // Automatic retry, only once a newer authorized listing has landed (never a timer loop).
  React.useEffect(() => {
    if (view.kind === "refreshing" && stamp !== undefined && stamp !== view.stampAtStart) {
      setAttempt((n) => n + 1);
    }
  }, [view, stamp]);

  const [download, setDownload] = React.useState<DownloadState>({ running: false, error: null });
  const downloadController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => downloadController.current?.abort(), []);

  const onDownload = async () => {
    if (downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownload({ running: true, error: null });
    try {
      await downloadImageArtifact(latestArtifact.current, { signal: controller.signal });
      if (!controller.signal.aborted) setDownload({ running: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted) setDownload({ running: false, error: errorCode(error) });
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
    }
  };

  const reload = () => {
    keepFocusInFigure();
    setAttempt((n) => n + 1);
  };

  // A lease that stopped being usable (expiry observed before the revoke event) is never shown.
  const readyLease = view.kind === "ready" && isLeaseUsable(view.lease) ? view.lease : null;
  const shown: ShownPreview = view.kind === "ready" ? EXPIRED : view;

  return (
    <ImageAttachmentView
      artifact={artifact}
      index={index}
      count={count}
      figureRef={figureRef}
      imageUrl={readyLease?.url ?? null}
      shown={shown}
      download={download}
      onDownload={() => void onDownload()}
      onReload={reload}
    />
  );
}

ChatImageAttachment.displayName = "ChatImageAttachment";
