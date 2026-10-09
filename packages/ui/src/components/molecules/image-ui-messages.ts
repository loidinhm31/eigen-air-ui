/**
 * Fixed, generic UI strings for image history/generation components, plus the focus handoff of
 * their recovery notices (`useNoticeFocusHandoff`).
 *
 * Every message is keyed by an enum (preview error code, adapter error kind, safe code, job
 * state). Raw error/response text, prompts, ids and paths are never interpolated.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type RefObject,
} from "react";
import {
  IMAGE_TERMINAL_JOB_STATES,
  type ImageJobSnapshot,
  type ImageJobState,
  type ImageSafeCode,
} from "@eigen-air-ui/shared/types";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
} from "../../adapters/factory/interfaces/IArtifactAdapter.js";
import type { ImagePreviewErrorCode } from "../../stores/image-preview-loader.js";

export const IMAGE_PREVIEW_ERROR_MESSAGES: Readonly<Record<ImagePreviewErrorCode, string>> = {
  unavailable: "This image is unavailable.",
  unsupported:
    "Image preview is not supported in this browser context (a secure context is required).",
  authorization_stale: "Image access needs to be refreshed.",
  denied: "This image is no longer available.",
  busy: "The image service is busy. Try again in a moment.",
  capacity: "Preview capacity reached. It loads when other previews are released.",
  failed: "The image could not be loaded.",
  aborted: "The image request was interrupted.",
};

export const IMAGE_DOWNLOAD_ERROR_MESSAGES: Readonly<Record<ImagePreviewErrorCode, string>> = {
  unavailable: "Download failed: the image is unavailable.",
  unsupported: "Download is not supported in this browser context (a secure context is required).",
  authorization_stale: "Download failed: image access needs to be refreshed.",
  denied: "Download failed: the image is no longer available.",
  busy: "Download failed: the image service is busy. Try again in a moment.",
  capacity: "Download failed: the image service is at capacity. Try again in a moment.",
  failed: "Download failed. Try again.",
  aborted: "Download was interrupted. Try again.",
};

/** Capability read failed: availability of image history is unknown (not "off"). */
export const IMAGE_CAPABILITY_FAILED_MESSAGE = "Image history could not be checked.";
/**
 * Deliberately not "Retry". The user-owned chat debug matrix test (V17,
 * `chat-debug-matrix-verification.test.tsx`) finds the chat error banner with
 * `getByRole("button", { name: /retry/i })`, which throws when a second button matches, and this
 * notice can share the screen with that banner: its accessible name must never match /retry/i (an
 * `aria-label` cannot disambiguate it either). Consequence, known and accepted: the listing-failure
 * notice (readers known, listing failed) is a plain "Retry" and has the same name as the chat
 * banner's button for assistive technology when both show. Rename only together with that test.
 */
export const IMAGE_CAPABILITY_CHECK_LABEL = "Check again";
/** Run-panel cancel failed; the job's real state stays visible in its row. */
export const IMAGE_CANCEL_FAILED_MESSAGE = "Could not cancel the image job. Check its status.";

const SAFE_CODE_LABELS: Readonly<Record<ImageSafeCode, string>> = {
  image_invalid_request: "The request was not accepted.",
  image_policy_denied: "Image generation is not permitted by policy.",
  image_operator_setup_required: "Image generation needs operator setup.",
  image_asset_invalid: "Required image assets are invalid.",
  image_profile_unqualified: "This device is not qualified for image generation.",
  image_resource_unavailable: "Image resources are unavailable right now.",
  image_busy: "Image generation is busy. Try again shortly.",
  image_timeout: "Image generation timed out.",
  image_cancelled: "Image generation was cancelled.",
  image_native_failed: "Image generation failed.",
  image_output_invalid: "The generated image was invalid.",
  image_publish_failed: "The generated image could not be saved.",
  image_indeterminate: "The outcome of image generation is unknown.",
  image_artifact_unavailable: "A generated image is unavailable.",
};

const ERROR_KIND_MESSAGES: Readonly<Record<ArtifactAdapterErrorKind, string>> = {
  unauthorized: "You are not authorized to use image generation.",
  not_found: "The requested image resource was not found.",
  invalid_request: "The request was not accepted.",
  conflict: "The job changed in the meantime. Check its status and try again.",
  unavailable: "Image generation is unavailable right now.",
  network: "Could not reach the daemon. Try again.",
  aborted: "The request was interrupted.",
  integrity: "Received an unexpected response.",
  too_large: "Received an unexpected response.",
  protocol: "Received an unexpected response.",
  page_cap: "Received an unexpected response.",
  unsupported: "This action is not supported in this browser context.",
};

const JOB_STATE_LABELS: Readonly<Record<ImageJobState, string>> = {
  admitted: "Queued",
  submitting: "Starting",
  running: "Generating",
  publishing: "Saving results",
  succeeded: "Completed",
  cancel_requested: "Cancel requested",
  failed: "Failed",
  partial_failed: "Partially failed",
  cancelled: "Cancelled",
  partial_cancelled: "Partially cancelled",
  indeterminate: "Outcome unknown",
};

/** Generic label for a decoded safe code (own lookup; unknown values get no text). */
export function imageSafeCodeLabel(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(SAFE_CODE_LABELS, code)
    ? SAFE_CODE_LABELS[code as ImageSafeCode]
    : null;
}

/** Message for an adapter error kind, preferring the safe-code label when one is attached. */
export function imageErrorKindMessage(kind: ArtifactAdapterErrorKind, code?: unknown): string {
  return imageSafeCodeLabel(code) ?? ERROR_KIND_MESSAGES[kind];
}

/** Message for any thrown value from templates/create/cancel calls. Never echoes error text. */
export function describeImageActionError(error: unknown): string {
  return error instanceof ArtifactAdapterError
    ? imageErrorKindMessage(error.kind, error.code)
    : "Something went wrong. Try again.";
}

/** Non-terminal job: more backend transitions are expected. */
export function isImageJobActive(job: ImageJobSnapshot): boolean {
  return !IMAGE_TERMINAL_JOB_STATES.includes(job.state);
}

/**
 * One-line status from the authoritative snapshot. `cancel_requested` stays "Cancel requested":
 * nothing is reported as killed until a snapshot shows a terminal state.
 */
export function imageJobSummary(job: ImageJobSnapshot): string {
  const parts = [
    JOB_STATE_LABELS[job.state],
    `${job.completed_count} of ${job.requested_count} images`,
  ];
  const reason = imageSafeCodeLabel(job.safe_code);
  if (reason !== null) parts.push(reason);
  return parts.join(" · ");
}

/**
 * What a recovery notice ("Check again" / listing "Retry") is waiting for:
 * `failed` a failure notice is shown, `busy` the recovery is in flight, `done` it settled
 * without a failure notice.
 */
export type NoticePhase = "failed" | "busy" | "done";

export interface NoticeFocusHandoff<K extends string> {
  /** Attach to the failure notice element (read by the handoff when a failure reappears). */
  boxRef: RefObject<HTMLDivElement | null>;
  /** Called by the notice when it unmounts while holding keyboard focus. */
  markLost(kind: K): void;
}

/**
 * Focus handoff for a failure notice whose button the user pressed. Pressing it starts a recovery
 * that unmounts the notice (and the focused button) immediately, which would drop focus to
 * `<body>` (WCAG 2.4.3). When the notice reported that it held focus, the handoff waits for the
 * outcome: a failure notice that reappears gets focus on its button again; a settled recovery
 * (`done`) focuses `resolveTarget(kind)` (made focusable if needed). Focus is only moved while it
 * is still on the body: if the user moved it elsewhere in the meantime (e.g. the chat input),
 * nothing is touched. `resetKey` (the session) drops a pending handoff.
 */
export function useNoticeFocusHandoff<K extends string>(
  phase: NoticePhase,
  resetKey: unknown,
  resolveTarget: (kind: K) => HTMLElement | null
): NoticeFocusHandoff<K> {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const pending = useRef<K | null>(null);
  const resolveRef = useRef(resolveTarget);
  useEffect(() => {
    resolveRef.current = resolveTarget;
  });
  useEffect(() => {
    pending.current = null;
  }, [resetKey]);
  useEffect(() => {
    const kind = pending.current;
    if (kind === null || phase === "busy") return;
    pending.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return; // focus moved on: leave it alone
    const target =
      phase === "failed" ? boxRef.current?.querySelector("button") : resolveRef.current(kind);
    if (!target) return;
    if (
      !target.hasAttribute("tabindex") &&
      !target.matches("button, a[href], input, select, textarea")
    ) {
      target.tabIndex = -1; // a heading/region made focusable only for this handoff
    }
    target.focus();
  });
  const markLost = useCallback((kind: K) => {
    pending.current = kind;
  }, []);
  return { boxRef, markLost };
}

/**
 * Used inside the notice component (shown as `kind`): when the notice unmounts while focus is
 * inside it, tells the handoff which notice the user was on when focus entered it (the same DOM
 * button turns from "Check again" into "Retry" while a recovery advances, so the kind at unmount
 * time is not the one the user pressed). Spread the returned `onFocus` on the notice box. A
 * layout-effect cleanup of the notice itself runs before React removes its DOM, so
 * `document.activeElement` is still the pressed button there (a parent's cleanup is too late).
 */
export function useReportFocusLost<K extends string>(
  handoff: NoticeFocusHandoff<K>,
  kind: K
): { onFocus: (event: FocusEvent<HTMLElement>) => void } {
  const { boxRef, markLost } = handoff;
  const origin = useRef(kind);
  useLayoutEffect(() => {
    const box = boxRef.current;
    return () => {
      if (box?.contains(document.activeElement)) markLost(origin.current);
    };
  }, [boxRef, markLost]);
  return {
    onFocus: (event) => {
      const from = event.relatedTarget;
      if (!(from instanceof Node && boxRef.current?.contains(from))) origin.current = kind;
    },
  };
}
