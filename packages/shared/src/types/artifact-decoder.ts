// Strict decoders for local image wire contracts (Phase 07): response DTOs here; request
// validators and WS hint decoders live in sibling modules and are re-exported below.
// Rules: exact key sets at every level (extra or missing required keys rejected), exact schema
// strings, bounded ids/counts/sizes. Errors name only OUR field paths; raw wire text (values or
// unknown key names) is never echoed. JSON `undefined` is treated as an absent key.
import {
  IMAGE_ARTIFACT_LIST_SCHEMA,
  IMAGE_ARTIFACT_SCHEMA,
  IMAGE_JOB_SCHEMA,
  IMAGE_JOB_STATES,
  IMAGE_MAX_ARTIFACTS_PER_JOB,
  IMAGE_MAX_BYTE_SIZE,
  IMAGE_MAX_COUNT,
  IMAGE_MAX_CURSOR_BYTES,
  IMAGE_MAX_LIST_ITEMS,
  IMAGE_MAX_RESULT_JSON_BYTES,
  IMAGE_MIN_COUNT,
  IMAGE_RESULT_SCHEMA,
  IMAGE_SAFE_CODES,
  IMAGE_TERMINAL_JOB_STATES,
  IMAGE_TEMPLATE_LIST_SCHEMA,
  type ImageArtifactList,
  type ImageArtifactRef,
  type ImageJobSnapshot,
  type ImageResult,
  type ImageSafeCode,
  type ImageTemplateList,
  type ImageTemplateSummary,
} from "./artifact.js";
import {
  ARTIFACT_STATES,
  EFFECTIVE_MODEL_ID,
  BACKENDS,
  MAX_STEPS,
  MAX_TEMPLATES,
  MAX_TEMPLATE_DESCRIPTION_BYTES,
  MAX_TEMPLATE_NAME_BYTES,
  MIN_STEPS,
  ORIGINS,
  QUALITIES,
  SHA256_REGEX,
  TEMPLATE_FIELDS,
  dimensions,
  exact,
  fail,
  has,
  id,
  int,
  literal,
  nullable,
  oneOf,
  rec,
  sizeString,
  text,
  utf8Bytes,
  type Rec,
} from "./artifact-decoder-primitives.js";

export { ImageDecodeError, isImageId } from "./artifact-decoder-primitives.js";
export {
  validateImageJobCancelRequest,
  validateImageJobCreateRequest,
} from "./artifact-request-decoder.js";
export {
  decodeImageArtifactCommittedEvent,
  decodeImageHintWsEvent,
  decodeImageJobUpdatedEvent,
  isImageHintEventName,
} from "./artifact-hint-decoder.js";

const ARTIFACT_KEYS = [
  "schema",
  "artifact_id",
  "job_id",
  "session_id",
  "run_id",
  "ordinal",
  "mime",
  "width",
  "height",
  "byte_size",
  "sha256",
  "created_at_ms",
  "state",
] as const;
const JOB_CORE_KEYS = [
  "job_id",
  "session_id",
  "run_id",
  "origin",
  "state",
  "requested_count",
  "completed_count",
  "effective_quality",
  "effective_width",
  "effective_height",
  "effective_steps",
  "effective_backend",
  "effective_model_id",
  "artifacts",
] as const;
const JOB_CORE_OPTIONAL = ["template_id", "tool_call_id", "safe_code"] as const;

// --- image_artifact.v1 ---

function artifactRef(value: unknown, path: string): ImageArtifactRef {
  const o = rec(value, path);
  exact(o, path, ARTIFACT_KEYS, ["tool_call_id"]);
  const state = oneOf(o.state, ARTIFACT_STATES, `${path}.state`);
  const [width, height] = dimensions(o, "width", "height", path);
  if (typeof o.sha256 !== "string" || !SHA256_REGEX.test(o.sha256)) fail(`${path}.sha256`);
  const ref: ImageArtifactRef = {
    schema: literal(o.schema, IMAGE_ARTIFACT_SCHEMA, `${path}.schema`),
    artifact_id: id(o.artifact_id, `${path}.artifact_id`),
    job_id: id(o.job_id, `${path}.job_id`),
    session_id: id(o.session_id, `${path}.session_id`),
    run_id: id(o.run_id, `${path}.run_id`),
    ordinal: int(o.ordinal, `${path}.ordinal`, 0, IMAGE_MAX_COUNT - 1),
    mime: literal(o.mime, "image/png", `${path}.mime`),
    width,
    height,
    // Committed artifacts carry real bytes; unavailable/deleted refs report 0.
    byte_size: int(
      o.byte_size,
      `${path}.byte_size`,
      state === "committed" ? 1 : 0,
      IMAGE_MAX_BYTE_SIZE
    ),
    sha256: o.sha256,
    created_at_ms: int(o.created_at_ms, `${path}.created_at_ms`, 1),
    state,
  };
  if (has(o, "tool_call_id")) ref.tool_call_id = id(o.tool_call_id, `${path}.tool_call_id`);
  return ref;
}

export function decodeImageArtifactRef(value: unknown): ImageArtifactRef {
  return artifactRef(value, "image_artifact");
}

// --- image_job.v1 / image_result.v1 shared core ---

type JobCore = Omit<
  ImageJobSnapshot,
  "schema" | "revision" | "created_at_ms" | "updated_at_ms" | "terminal_at_ms"
>;

function jobCore(o: Rec, path: string): JobCore {
  const origin = oneOf(o.origin, ORIGINS, `${path}.origin`);
  const hasTemplate = has(o, "template_id");
  const hasToolCall = has(o, "tool_call_id");
  // agent_tool requires tool_call_id and forbids template_id; direct_template the inverse.
  if (origin === "agent_tool" ? hasTemplate || !hasToolCall : hasToolCall || !hasTemplate) {
    fail(`${path}.origin`);
  }
  const job_id = id(o.job_id, `${path}.job_id`);
  const session_id = id(o.session_id, `${path}.session_id`);
  const run_id = id(o.run_id, `${path}.run_id`);
  const requested_count = int(
    o.requested_count,
    `${path}.requested_count`,
    IMAGE_MIN_COUNT,
    IMAGE_MAX_COUNT
  );
  const completed_count = int(o.completed_count, `${path}.completed_count`, 0, requested_count);
  const [effective_width, effective_height] = dimensions(
    o,
    "effective_width",
    "effective_height",
    path
  );
  if (!Array.isArray(o.artifacts) || o.artifacts.length > IMAGE_MAX_ARTIFACTS_PER_JOB) {
    fail(`${path}.artifacts`);
  }
  const tool_call_id = hasToolCall ? id(o.tool_call_id, `${path}.tool_call_id`) : undefined;
  const artifacts = o.artifacts.map((a, i) => artifactRef(a, `${path}.artifacts[${i}]`));
  // Rust `validate_job_artifacts` (request.rs:1682-1699): one artifact per completed image and
  // the state must agree with the counts (active states only need completed <= requested).
  const state = oneOf(o.state, IMAGE_JOB_STATES, `${path}.state`);
  if (artifacts.length !== completed_count) fail(`${path}.artifacts`);
  if (
    (state === "succeeded" && completed_count !== requested_count) ||
    ((state === "failed" || state === "cancelled") && completed_count !== 0) ||
    ((state === "partial_failed" || state === "partial_cancelled") &&
      (completed_count === 0 || completed_count >= requested_count))
  ) {
    fail(`${path}.completed_count`);
  }
  // Rust `validate_controls` (request.rs:1630-1648): resolved quality is never `auto`.
  const effective_quality = oneOf(o.effective_quality, QUALITIES, `${path}.effective_quality`);
  if (effective_quality === "auto") fail(`${path}.effective_quality`);
  const ordinals = new Set<number>();
  const ids = new Set<string>();
  for (const [i, a] of artifacts.entries()) {
    // Artifacts must belong to this exact job scope; ids are unique within a job.
    if (
      a.job_id !== job_id ||
      a.session_id !== session_id ||
      a.run_id !== run_id ||
      a.tool_call_id !== tool_call_id ||
      a.ordinal >= requested_count ||
      ordinals.has(a.ordinal) ||
      ids.has(a.artifact_id)
    ) {
      fail(`${path}.artifacts[${i}]`);
    }
    ordinals.add(a.ordinal);
    ids.add(a.artifact_id);
  }
  const core: JobCore = {
    job_id,
    session_id,
    run_id,
    origin,
    state,
    requested_count,
    completed_count,
    effective_quality,
    effective_width,
    effective_height,
    effective_steps: int(o.effective_steps, `${path}.effective_steps`, MIN_STEPS, MAX_STEPS),
    effective_backend: oneOf(o.effective_backend, BACKENDS, `${path}.effective_backend`),
    effective_model_id: literal(
      o.effective_model_id,
      EFFECTIVE_MODEL_ID,
      `${path}.effective_model_id`
    ),
    safe_code: nullable(o, "safe_code", (v) =>
      oneOf<ImageSafeCode>(v, IMAGE_SAFE_CODES, `${path}.safe_code`)
    ),
    artifacts,
  };
  if (hasTemplate) core.template_id = id(o.template_id, `${path}.template_id`);
  if (tool_call_id !== undefined) core.tool_call_id = tool_call_id;
  return core;
}

export function decodeImageJobSnapshot(value: unknown): ImageJobSnapshot {
  const path = "image_job";
  const o = rec(value, path);
  exact(
    o,
    path,
    [...JOB_CORE_KEYS, "schema", "revision", "created_at_ms", "updated_at_ms"],
    [...JOB_CORE_OPTIONAL, "terminal_at_ms"]
  );
  const schema = literal(o.schema, IMAGE_JOB_SCHEMA, `${path}.schema`);
  const core = jobCore(o, path);
  const revision = int(o.revision, `${path}.revision`, 1);
  const created_at_ms = int(o.created_at_ms, `${path}.created_at_ms`, 1);
  const updated_at_ms = int(o.updated_at_ms, `${path}.updated_at_ms`, created_at_ms);
  const terminal_at_ms = nullable(o, "terminal_at_ms", (v) =>
    int(v, `${path}.terminal_at_ms`, created_at_ms, updated_at_ms)
  );
  // Rust `ImageJobSnapshot::validate` (request.rs:1146-1162): terminal_at_ms exists iff the
  // state is terminal; safe_code is forbidden on success and required on other terminal states.
  const terminal = IMAGE_TERMINAL_JOB_STATES.includes(core.state);
  if (terminal !== (terminal_at_ms !== null)) fail(`${path}.terminal_at_ms`);
  if (core.state === "succeeded" ? core.safe_code !== null : terminal && core.safe_code === null) {
    fail(`${path}.safe_code`);
  }
  for (const [i, a] of core.artifacts.entries()) {
    if (a.created_at_ms < created_at_ms || a.created_at_ms > updated_at_ms) {
      fail(`${path}.artifacts[${i}].created_at_ms`);
    }
  }
  return { schema, ...core, revision, created_at_ms, updated_at_ms, terminal_at_ms };
}

export function decodeImageResult(value: unknown): ImageResult {
  const path = "image_result";
  const o = rec(value, path);
  exact(o, path, [...JOB_CORE_KEYS, "schema", "elapsed_ms"], JOB_CORE_OPTIONAL);
  const schema = literal(o.schema, IMAGE_RESULT_SCHEMA, `${path}.schema`);
  // Semantic 8 KiB envelope budget (compact JSON of the received value).
  if (utf8Bytes(JSON.stringify(o)) > IMAGE_MAX_RESULT_JSON_BYTES) fail(path);
  const core = jobCore(o, path);
  // Rust `ImageResultV1::validate` (request.rs:1066-1077): success carries no safe_code and only
  // committed artifacts; every other state (active included) requires a safe_code.
  if (core.state === "succeeded") {
    if (core.safe_code !== null) fail(`${path}.safe_code`);
    const stale = core.artifacts.findIndex((a) => a.state !== "committed");
    if (stale >= 0) fail(`${path}.artifacts[${stale}].state`);
  } else if (core.safe_code === null) {
    fail(`${path}.safe_code`);
  }
  return { schema, ...core, elapsed_ms: int(o.elapsed_ms, `${path}.elapsed_ms`, 0) };
}

// --- image_artifact_list.v1 ---

export function decodeImageArtifactList(value: unknown): ImageArtifactList {
  const path = "image_artifact_list";
  const o = rec(value, path);
  exact(o, path, ["schema", "items"], ["next_cursor"]);
  const schema = literal(o.schema, IMAGE_ARTIFACT_LIST_SCHEMA, `${path}.schema`);
  if (!Array.isArray(o.items) || o.items.length > IMAGE_MAX_LIST_ITEMS) fail(`${path}.items`);
  return {
    schema,
    items: o.items.map((item, i) => artifactRef(item, `${path}.items[${i}]`)),
    next_cursor: nullable(o, "next_cursor", (v) =>
      text(v, `${path}.next_cursor`, IMAGE_MAX_CURSOR_BYTES)
    ),
  };
}

// --- image_template_list.v1 ---

function templateSummary(value: unknown, path: string): ImageTemplateSummary {
  const o = rec(value, path);
  exact(o, path, ["id", "name", "description", "editable_fields", "defaults"]);
  if (!Array.isArray(o.editable_fields) || o.editable_fields.length > TEMPLATE_FIELDS.length) {
    fail(`${path}.editable_fields`);
  }
  const editable_fields = o.editable_fields.map((f) =>
    oneOf(f, TEMPLATE_FIELDS, `${path}.editable_fields`)
  );
  if (new Set(editable_fields).size !== editable_fields.length) fail(`${path}.editable_fields`);
  const d = rec(o.defaults, `${path}.defaults`);
  exact(d, `${path}.defaults`, ["quality", "size", "n"]);
  return {
    id: id(o.id, `${path}.id`),
    name: text(o.name, `${path}.name`, MAX_TEMPLATE_NAME_BYTES),
    description: text(o.description, `${path}.description`, MAX_TEMPLATE_DESCRIPTION_BYTES),
    editable_fields,
    defaults: {
      quality: oneOf(d.quality, QUALITIES, `${path}.defaults.quality`),
      size: sizeString(d.size, `${path}.defaults.size`),
      n: int(d.n, `${path}.defaults.n`, IMAGE_MIN_COUNT, IMAGE_MAX_COUNT),
    },
  };
}

export function decodeImageTemplateList(value: unknown): ImageTemplateList {
  const path = "image_template_list";
  const o = rec(value, path);
  exact(o, path, ["schema", "revision", "templates"]);
  const schema = literal(o.schema, IMAGE_TEMPLATE_LIST_SCHEMA, `${path}.schema`);
  if (!Array.isArray(o.templates) || o.templates.length > MAX_TEMPLATES) fail(`${path}.templates`);
  const templates = o.templates.map((t, i) => templateSummary(t, `${path}.templates[${i}]`));
  if (new Set(templates.map((t) => t.id)).size !== templates.length) fail(`${path}.templates`);
  return { schema, revision: int(o.revision, `${path}.revision`, 1), templates };
}
