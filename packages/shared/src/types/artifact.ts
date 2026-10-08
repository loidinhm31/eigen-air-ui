// Local image generation wire contracts (Phase 07). Wire is snake_case and kept as-is in
// these types (same convention as tool-approval.ts / task-progress.ts); the frontend never
// renames fields at the shared layer. Authority: backend `local-image-v1.json` fixture.
import type { GatewayCapabilities } from "./api.js";

// --- Schemas / versions ---

export const IMAGE_ARTIFACT_SCHEMA = "image_artifact.v1" as const;
export const IMAGE_JOB_SCHEMA = "image_job.v1" as const;
export const IMAGE_ARTIFACT_LIST_SCHEMA = "image_artifact_list.v1" as const;
export const IMAGE_RESULT_SCHEMA = "image_result.v1" as const;
export const IMAGE_TEMPLATE_LIST_SCHEMA = "image_template_list.v1" as const;

/** `capabilities.image_artifacts_version` value that enables historical readers. */
export const IMAGE_ARTIFACTS_CAPABILITY_VERSION = "image_artifacts.v1" as const;
/** `capabilities.local_image_version` value that enables generation/direct-template actions. */
export const LOCAL_IMAGE_CAPABILITY_VERSION = "local_image.v1" as const;

// --- Bounds (mirror backend contract) ---

export const IMAGE_MAX_ID_BYTES = 128;
export const IMAGE_MAX_ARTIFACTS_PER_JOB = 4;
export const IMAGE_MAX_LIST_ITEMS = 100;
export const IMAGE_MAX_CURSOR_BYTES = 1024;
export const IMAGE_MAX_RESULT_JSON_BYTES = 8 * 1024;
export const IMAGE_MAX_BYTE_SIZE = 16 * 1024 * 1024;
/** Output bounds mirror Rust MIN_DIMENSION / MAX_DIMENSION / DIMENSION_ALIGNMENT / MAX_PIXELS (request.rs:41-44). */
export const IMAGE_OUTPUT_MIN_EDGE = 256;
export const IMAGE_OUTPUT_MAX_EDGE = 2048;
export const IMAGE_OUTPUT_DIMENSION_ALIGNMENT = 32;
export const IMAGE_OUTPUT_MAX_PIXELS = 2048 * 2048;
export const IMAGE_MAX_SEED = 2_147_483_647;
export const IMAGE_MAX_PROMPT_BYTES = 8192;
export const IMAGE_MAX_NEGATIVE_PROMPT_BYTES = 2048;
export const IMAGE_MIN_COUNT = 1;
export const IMAGE_MAX_COUNT = 4;
export const IMAGE_CREATE_REQUEST_MAX_BYTES = 32 * 1024;
export const IMAGE_CANCEL_REQUEST_MAX_BYTES = 8 * 1024;

// --- Enums ---

export type ImageArtifactState = "committed" | "unavailable" | "deleted";

export type ImageJobState =
  | "admitted"
  | "submitting"
  | "running"
  | "publishing"
  | "succeeded"
  | "cancel_requested"
  | "failed"
  | "partial_failed"
  | "cancelled"
  | "partial_cancelled"
  | "indeterminate";

export type ImageSafeCode =
  | "image_invalid_request"
  | "image_policy_denied"
  | "image_operator_setup_required"
  | "image_asset_invalid"
  | "image_profile_unqualified"
  | "image_resource_unavailable"
  | "image_busy"
  | "image_timeout"
  | "image_cancelled"
  | "image_native_failed"
  | "image_output_invalid"
  | "image_publish_failed"
  | "image_indeterminate"
  | "image_artifact_unavailable";

export type ImageOrigin = "agent_tool" | "direct_template";
export type ImageQuality = "auto" | "draft" | "fast" | "balanced" | "high" | "max";
export type ImageBackend = "vulkan" | "cpu";
export type ImageNamedSize = "square" | "portrait" | "landscape" | "tall" | "wide";
export type ImageTemplateField =
  | "prompt"
  | "negative_prompt"
  | "quality"
  | "size"
  | "seed"
  | "n"
  | "steps"
  | "edit_image"
  | "strength"
  | "images";

export const IMAGE_JOB_STATES: readonly ImageJobState[] = [
  "admitted",
  "submitting",
  "running",
  "publishing",
  "succeeded",
  "cancel_requested",
  "failed",
  "partial_failed",
  "cancelled",
  "partial_cancelled",
  "indeterminate",
];

/** Terminal states: no further backend transitions. */
export const IMAGE_TERMINAL_JOB_STATES: readonly ImageJobState[] = [
  "succeeded",
  "failed",
  "partial_failed",
  "cancelled",
  "partial_cancelled",
  "indeterminate",
];

export const IMAGE_SAFE_CODES: readonly ImageSafeCode[] = [
  "image_invalid_request",
  "image_policy_denied",
  "image_operator_setup_required",
  "image_asset_invalid",
  "image_profile_unqualified",
  "image_resource_unavailable",
  "image_busy",
  "image_timeout",
  "image_cancelled",
  "image_native_failed",
  "image_output_invalid",
  "image_publish_failed",
  "image_indeterminate",
  "image_artifact_unavailable",
];

// --- Response models ---

/** `image_artifact.v1`. `tool_call_id` is absent when the artifact was not produced by a tool call. */
export interface ImageArtifactRef {
  schema: typeof IMAGE_ARTIFACT_SCHEMA;
  artifact_id: string;
  job_id: string;
  session_id: string;
  run_id: string;
  ordinal: number;
  mime: "image/png";
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
  created_at_ms: number;
  state: ImageArtifactState;
  tool_call_id?: string;
}

interface ImageJobCore {
  job_id: string;
  session_id: string;
  run_id: string;
  origin: ImageOrigin;
  /** Present iff origin === "direct_template". */
  template_id?: string;
  /** Present iff origin === "agent_tool". */
  tool_call_id?: string;
  state: ImageJobState;
  requested_count: number;
  completed_count: number;
  effective_quality: ImageQuality;
  effective_width: number;
  effective_height: number;
  effective_steps: number;
  effective_backend: ImageBackend;
  effective_model_id: string;
  /** Wire may omit or send null; normalized to null by the decoder. */
  safe_code: ImageSafeCode | null;
  artifacts: ImageArtifactRef[];
}

/** `image_job.v1`. Optional wire `terminal_at_ms`/`safe_code` normalize to null. */
export interface ImageJobSnapshot extends ImageJobCore {
  schema: typeof IMAGE_JOB_SCHEMA;
  revision: number;
  created_at_ms: number;
  updated_at_ms: number;
  terminal_at_ms: number | null;
}

/** `image_result.v1` (agent tool / direct template result envelope, <= 8 KiB JSON). */
export interface ImageResult extends ImageJobCore {
  schema: typeof IMAGE_RESULT_SCHEMA;
  elapsed_ms: number;
}

/** `image_artifact_list.v1`. Wire may omit or send null `next_cursor`; normalized to null. */
export interface ImageArtifactList {
  schema: typeof IMAGE_ARTIFACT_LIST_SCHEMA;
  items: ImageArtifactRef[];
  next_cursor: string | null;
}

export interface ImageTemplateDefaults {
  quality: ImageQuality;
  size: string;
  n: number;
}

export interface ImageTemplateSummary {
  id: string;
  name: string;
  description: string;
  editable_fields: ImageTemplateField[];
  defaults: ImageTemplateDefaults;
}

/** `image_template_list.v1` (public metadata; prompt template text is never sent). */
export interface ImageTemplateList {
  schema: typeof IMAGE_TEMPLATE_LIST_SCHEMA;
  revision: number;
  templates: ImageTemplateSummary[];
}

// --- Request models ---

export interface ImageJobSettings {
  quality?: ImageQuality;
  /** Named size or `WxH` (256..2048 per edge). */
  size?: string;
  seed?: number;
  n?: number;
}

/** POST /v1/image-jobs body (strict, <= 32 KiB). */
export interface ImageJobCreateRequest {
  template_id: string;
  prompt: string;
  negative_prompt?: string;
  settings?: ImageJobSettings;
  session_id: string;
}

/** POST /v1/image-jobs/:id/cancel body (strict, <= 8 KiB). `expected_revision` >= 1. */
export interface ImageJobCancelRequest {
  session_id: string;
  run_id: string;
  expected_revision: number;
}

// --- WS metadata hints (refetch signals only; never authority) ---

export interface ImageJobUpdatedPayload {
  job_id: string;
  session_id: string;
  run_id: string;
  state: ImageJobState;
  revision: number;
  requested_count: number;
  completed_count: number;
  safe_code?: ImageSafeCode;
}

export interface ImageArtifactCommittedPayload {
  artifact_id: string;
  job_id: string;
  ordinal: number;
  state: ImageArtifactState;
  revision: number;
}

// --- Capability helpers (independent gates; unknown/missing => false) ---

type CapabilitiesInput = GatewayCapabilities | null | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Historical image readers (list/bytes/job snapshot) are available. */
export function imageReadersAvailable(caps: CapabilitiesInput): boolean {
  return (
    isObject(caps) &&
    caps.image_artifacts === true &&
    caps.image_artifacts_version === IMAGE_ARTIFACTS_CAPABILITY_VERSION
  );
}

/** Direct-template generation/cancel actions are available. */
export function imageGenerationAvailable(caps: CapabilitiesInput): boolean {
  return (
    isObject(caps) &&
    caps.local_image === true &&
    caps.local_image_version === LOCAL_IMAGE_CAPABILITY_VERSION
  );
}
