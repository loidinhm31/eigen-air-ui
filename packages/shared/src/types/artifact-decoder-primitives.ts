// Shared primitives for the strict local-image decoders (Phase 07). Internal to the
// artifact-*-decoder modules; the public surface is re-exported from artifact-decoder.ts.
// All failures name only OUR field paths, never raw wire text.
import type {
  ImageArtifactState,
  ImageBackend,
  ImageOrigin,
  ImageQuality,
  ImageTemplateField,
} from "./artifact.js";
import {
  IMAGE_OUTPUT_DIMENSION_ALIGNMENT,
  IMAGE_OUTPUT_MAX_EDGE,
  IMAGE_OUTPUT_MAX_PIXELS,
  IMAGE_OUTPUT_MIN_EDGE,
} from "./artifact.js";

export class ImageDecodeError extends Error {
  constructor(message = "Invalid image payload") {
    super(message);
    this.name = "ImageDecodeError";
  }
}

export type Rec = Record<string, unknown>;

const ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
export const SHA256_REGEX = /^[0-9a-f]{64}$/;
export const SIZE_REGEX = /^(\d{1,4})x(\d{1,4})$/;
export const NAMED_SIZES: readonly string[] = ["square", "portrait", "landscape", "tall", "wide"];
export const QUALITIES: readonly ImageQuality[] = [
  "auto",
  "draft",
  "fast",
  "balanced",
  "high",
  "max",
];
export const BACKENDS: readonly ImageBackend[] = ["vulkan", "cpu"];
export const ORIGINS: readonly ImageOrigin[] = ["agent_tool", "direct_template"];
export const ARTIFACT_STATES: readonly ImageArtifactState[] = [
  "committed",
  "unavailable",
  "deleted",
];
export const TEMPLATE_FIELDS: readonly ImageTemplateField[] = [
  "prompt",
  "negative_prompt",
  "quality",
  "size",
  "seed",
  "n",
  "steps",
  "edit_image",
  "strength",
  "images",
];
/** Rust `validate_controls` (request.rs:1630-1648) accepts exactly this effective model. */
export const EFFECTIVE_MODEL_ID = "qwen-image-2.1";

export const MAX_TEMPLATES = 16;
export const MAX_TEMPLATE_NAME_BYTES = 64;
export const MAX_TEMPLATE_DESCRIPTION_BYTES = 512;
export const MAX_TEMPLATE_SIZE_BYTES = 32;
export const MIN_STEPS = 4;
export const MAX_STEPS = 60;

// --- Primitive helpers (all failures name only the field path) ---

export function fail(path: string): never {
  throw new ImageDecodeError(`Invalid image field: ${path}`);
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function rec(value: unknown, path: string): Rec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path);
  return value as Rec;
}

export function has(o: Rec, key: string): boolean {
  return o[key] !== undefined;
}

/** Reject any key outside `required ∪ optional` and any missing required key. */
export function exact(
  o: Rec,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(o)) {
    if (o[key] !== undefined && !allowed.has(key)) fail(`${path}.<keys>`);
  }
  for (const key of required) if (!has(o, key)) fail(`${path}.<keys>`);
}

export function int(
  value: unknown,
  path: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(path);
  }
  return value;
}

/**
 * Identifier charset `[A-Za-z0-9._:-]`, 1..128 bytes (Rust `validate_id`, request.rs:1568-1578).
 * Charset only: callers embedding ids in URL paths add their own traversal checks.
 */
export function isImageId(value: unknown): value is string {
  return typeof value === "string" && ID_REGEX.test(value);
}

export function id(value: unknown, path: string): string {
  if (!isImageId(value)) fail(path);
  return value;
}

/** Non-empty text bounded in UTF-8 bytes with no NUL. */
export function text(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxBytes || // UTF-16 length is a lower bound of UTF-8 bytes
    value.includes("\u0000") ||
    utf8Bytes(value) > maxBytes
  ) {
    fail(path);
  }
  return value;
}

export function oneOf<T extends string>(value: unknown, set: readonly T[], path: string): T {
  if (typeof value !== "string" || !set.includes(value as T)) fail(path);
  return value as T;
}

export function literal<T extends string>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path);
  return expected;
}

/**
 * Output dimensions as Rust validates them for artifacts and effective controls
 * (request.rs:953-978, 1637-1640, 1543-1551): each edge 256..2048, multiple of 32,
 * area <= 2048*2048.
 */
export function dimensions(o: Rec, wKey: string, hKey: string, path: string): [number, number] {
  const edge = (key: string): number => {
    const value = int(o[key], `${path}.${key}`, IMAGE_OUTPUT_MIN_EDGE, IMAGE_OUTPUT_MAX_EDGE);
    if (value % IMAGE_OUTPUT_DIMENSION_ALIGNMENT !== 0) fail(`${path}.${key}`);
    return value;
  };
  const width = edge(wKey);
  const height = edge(hKey);
  if (width * height > IMAGE_OUTPUT_MAX_PIXELS) fail(`${path}.${wKey}`);
  return [width, height];
}

/** Named size or `WxH` (256..2048 per edge, <= 4 Mpx), as accepted by the create route. */
export function sizeString(value: unknown, path: string): string {
  if (typeof value !== "string" || utf8Bytes(value) > MAX_TEMPLATE_SIZE_BYTES) fail(path);
  if (NAMED_SIZES.includes(value)) return value;
  const match = SIZE_REGEX.exec(value);
  if (!match) fail(path);
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (
    w < IMAGE_OUTPUT_MIN_EDGE ||
    w > IMAGE_OUTPUT_MAX_EDGE ||
    h < IMAGE_OUTPUT_MIN_EDGE ||
    h > IMAGE_OUTPUT_MAX_EDGE ||
    w * h > IMAGE_OUTPUT_MAX_PIXELS
  ) {
    fail(path);
  }
  return value;
}

/** Wire may omit the key or send null for nullable fields. */
export function nullable<T>(o: Rec, key: string, read: (v: unknown) => T): T | null {
  return o[key] === undefined || o[key] === null ? null : read(o[key]);
}
