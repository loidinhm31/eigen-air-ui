/**
 * Pure form model + request builder for the direct-template image action, plus the in-memory
 * draft owner hook (`useDirectImageDraft`).
 *
 * Only the template's `editable_fields` are sent (the server rejects overrides of any other
 * field) and only values that differ from the template defaults. The shared strict validator
 * `validateImageJobCreateRequest` is the final gate; error strings are fixed text and never
 * echo input.
 */
import { useCallback, useEffect, useState } from "react";
import {
  IMAGE_MAX_NEGATIVE_PROMPT_BYTES,
  IMAGE_MAX_PROMPT_BYTES,
  IMAGE_MAX_SEED,
  validateImageJobCreateRequest,
  type ImageJobCreateRequest,
  type ImageJobSettings,
  type ImageQuality,
  type ImageTemplateSummary,
  type ImageJobSnapshot,
} from "@eigen-air-ui/shared/types";
import { isImageJobActive } from "./image-ui-messages.js";

export const IMAGE_QUALITY_OPTIONS: readonly ImageQuality[] = [
  "auto",
  "draft",
  "fast",
  "balanced",
  "high",
  "max",
];
export const IMAGE_NAMED_SIZE_OPTIONS: readonly string[] = [
  "square",
  "portrait",
  "landscape",
  "tall",
  "wide",
];
export const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

export interface DirectImageForm {
  templateId: string;
  prompt: string;
  negativePrompt: string;
  quality: string;
  size: string;
  seed: string;
  n: string;
}

export interface DirectImageFieldErrors {
  prompt?: string;
  negativePrompt?: string;
  seed?: string;
  form?: string;
}

/** UTF-8 byte length without allocating (counts like `TextEncoder`: lone surrogates are 3 bytes). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      i + 1 < value.length &&
      (value.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The direct job to show for a session, derived from TRACKED store jobs (`jobs` oldest first, as
 * returned by `useTrackedImageJobs`). Only `direct_template` jobs of `sessionId` qualify. The
 * newest ACTIVE job wins so every active job stays cancelable one after the other; with none
 * active, the newest job shows its terminal state.
 */
export function pickDirectImageJob(
  jobs: readonly ImageJobSnapshot[],
  sessionId: string
): ImageJobSnapshot | undefined {
  let newest: ImageJobSnapshot | undefined;
  let newestActive: ImageJobSnapshot | undefined;
  for (const candidate of jobs) {
    if (candidate.origin !== "direct_template" || candidate.session_id !== sessionId) continue;
    newest = candidate;
    if (isImageJobActive(candidate)) newestActive = candidate;
  }
  return newestActive ?? newest;
}

/**
 * Module-level registry of in-flight `createJob` requests, keyed by session. A submission must
 * survive the panel closing (the server may already have created the job), and a re-opened panel
 * must not submit a second one while the first is unresolved.
 */
const inFlightSessions = new Set<string>();
const submissionListeners = new Set<() => void>();

export const directImageSubmissions = {
  subscribe(listener: () => void): () => void {
    submissionListeners.add(listener);
    return () => void submissionListeners.delete(listener);
  },
  isPending: (sessionId: string): boolean => inFlightSessions.has(sessionId),
  /** False when a submission for this session is already in flight (caller must not submit). */
  begin(sessionId: string): boolean {
    if (inFlightSessions.has(sessionId)) return false;
    inFlightSessions.add(sessionId);
    submissionListeners.forEach((listener) => listener());
    return true;
  },
  end(sessionId: string): void {
    if (inFlightSessions.delete(sessionId)) submissionListeners.forEach((listener) => listener());
  },
};

export function isFieldEditable(template: ImageTemplateSummary, field: string): boolean {
  return (template.editable_fields as string[]).includes(field);
}

/** Fresh form for a template (defaults); a template switch keeps the typed prompts. */
export function formForTemplate(
  template: ImageTemplateSummary,
  previous?: DirectImageForm
): DirectImageForm {
  return {
    templateId: template.id,
    prompt: previous?.prompt ?? "",
    negativePrompt: previous?.negativePrompt ?? "",
    quality: template.defaults.quality,
    size: template.defaults.size,
    seed: "",
    n: String(template.defaults.n),
  };
}

/** Functional update of the draft (like a React state setter); `null` clears it. */
export type DirectImageDraftUpdate = (current: DirectImageForm | null) => DirectImageForm | null;

export interface DirectImageDraftOwner {
  /** The draft of the current session, or `null` (nothing typed, cleared, other session). */
  draft: DirectImageForm | null;
  onDraftChange(update: DirectImageDraftUpdate): void;
}

/**
 * Memory-only draft (prompt, negative prompt, template, settings) of the direct-template form.
 * The panel unmounts on close, so the draft lives in the component that survives it. It is
 * keyed by session: another session never sees it and a session change drops it. It is never
 * written to any store or storage and never rendered into labels, alt text or error strings.
 */
export function useDirectImageDraft(sessionId: string | null): DirectImageDraftOwner {
  const [state, setState] = useState<{ sessionId: string; form: DirectImageForm } | null>(null);

  useEffect(() => {
    setState(null);
  }, [sessionId]);

  const onDraftChange = useCallback(
    (update: DirectImageDraftUpdate) => {
      if (sessionId === null) return;
      setState((current) => {
        // A late callback of a panel of another session must not touch this session's draft.
        if (current !== null && current.sessionId !== sessionId) return current;
        const before = current?.form ?? null;
        const next = update(before);
        if (next === before) return current;
        return next === null ? null : { sessionId, form: next };
      });
    },
    [sessionId]
  );

  return {
    draft: state !== null && state.sessionId === sessionId ? state.form : null,
    onDraftChange,
  };
}

function textError(value: string, maxBytes: number, subject: string): string | undefined {
  if (value.includes("\u0000")) return `${subject} contains an unsupported character.`;
  if (utf8ByteLength(value) > maxBytes) return `${subject} is too long (max ${maxBytes} bytes).`;
  return undefined;
}

export function buildDirectImageRequest(
  template: ImageTemplateSummary,
  form: DirectImageForm,
  sessionId: string
): { request: ImageJobCreateRequest } | { errors: DirectImageFieldErrors } {
  const errors: DirectImageFieldErrors = {};

  if (form.prompt.trim().length === 0) errors.prompt = "Enter a prompt.";
  else errors.prompt = textError(form.prompt, IMAGE_MAX_PROMPT_BYTES, "Prompt");

  const negative = isFieldEditable(template, "negative_prompt") ? form.negativePrompt : "";
  if (negative.length > 0) {
    errors.negativePrompt = textError(negative, IMAGE_MAX_NEGATIVE_PROMPT_BYTES, "Negative prompt");
  }

  const seedText = isFieldEditable(template, "seed") ? form.seed.trim() : "";
  if (seedText.length > 0 && !(/^\d{1,10}$/.test(seedText) && Number(seedText) <= IMAGE_MAX_SEED)) {
    errors.seed = `Seed must be a whole number from 0 to ${IMAGE_MAX_SEED}.`;
  }
  if (errors.prompt || errors.negativePrompt || errors.seed) return { errors };

  const settings: ImageJobSettings = {};
  if (isFieldEditable(template, "quality") && form.quality !== template.defaults.quality) {
    settings.quality = form.quality as ImageQuality;
  }
  if (isFieldEditable(template, "size") && form.size !== template.defaults.size) {
    settings.size = form.size;
  }
  if (seedText.length > 0) settings.seed = Number(seedText);
  if (isFieldEditable(template, "n") && Number(form.n) !== template.defaults.n) {
    settings.n = Number(form.n);
  }

  const candidate: ImageJobCreateRequest = {
    template_id: template.id,
    prompt: form.prompt,
    session_id: sessionId,
  };
  if (negative.length > 0) candidate.negative_prompt = negative;
  if (Object.keys(settings).length > 0) candidate.settings = settings;
  try {
    return { request: validateImageJobCreateRequest(candidate) };
  } catch {
    return { errors: { form: "The request is not valid. Check the fields and try again." } };
  }
}
