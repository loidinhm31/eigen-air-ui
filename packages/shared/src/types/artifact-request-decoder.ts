// Strict validators for local-image request bodies (create / cancel).
import {
  IMAGE_MAX_COUNT,
  IMAGE_MAX_NEGATIVE_PROMPT_BYTES,
  IMAGE_MAX_PROMPT_BYTES,
  IMAGE_MAX_SEED,
  IMAGE_MIN_COUNT,
  type ImageJobCancelRequest,
  type ImageJobCreateRequest,
  type ImageJobSettings,
} from "./artifact.js";
import {
  QUALITIES,
  exact,
  has,
  id,
  int,
  oneOf,
  rec,
  sizeString,
  text,
} from "./artifact-decoder-primitives.js";

function settings(value: unknown, path: string): ImageJobSettings {
  const o = rec(value, path);
  exact(o, path, [], ["quality", "size", "seed", "n"]);
  const out: ImageJobSettings = {};
  if (has(o, "quality")) out.quality = oneOf(o.quality, QUALITIES, `${path}.quality`);
  if (has(o, "size")) out.size = sizeString(o.size, `${path}.size`);
  if (has(o, "seed")) out.seed = int(o.seed, `${path}.seed`, 0, IMAGE_MAX_SEED);
  if (has(o, "n")) out.n = int(o.n, `${path}.n`, IMAGE_MIN_COUNT, IMAGE_MAX_COUNT);
  return out;
}

/**
 * Validate a POST /v1/image-jobs body. Prompt 1..8192 UTF-8 bytes, negative_prompt (when present)
 * 1..2048 bytes, neither may contain NUL. Throws ImageDecodeError; never echoes input text.
 */
export function validateImageJobCreateRequest(value: unknown): ImageJobCreateRequest {
  const path = "image_job_create";
  const o = rec(value, path);
  exact(o, path, ["template_id", "prompt", "session_id"], ["negative_prompt", "settings"]);
  const req: ImageJobCreateRequest = {
    template_id: id(o.template_id, `${path}.template_id`),
    prompt: text(o.prompt, `${path}.prompt`, IMAGE_MAX_PROMPT_BYTES),
    session_id: id(o.session_id, `${path}.session_id`),
  };
  if (has(o, "negative_prompt")) {
    req.negative_prompt = text(
      o.negative_prompt,
      `${path}.negative_prompt`,
      IMAGE_MAX_NEGATIVE_PROMPT_BYTES
    );
  }
  if (has(o, "settings")) req.settings = settings(o.settings, `${path}.settings`);
  return req;
}

/** Validate a POST /v1/image-jobs/:id/cancel body (`expected_revision >= 1`). */
export function validateImageJobCancelRequest(value: unknown): ImageJobCancelRequest {
  const path = "image_job_cancel";
  const o = rec(value, path);
  exact(o, path, ["session_id", "run_id", "expected_revision"]);
  return {
    session_id: id(o.session_id, `${path}.session_id`),
    run_id: id(o.run_id, `${path}.run_id`),
    expected_revision: int(o.expected_revision, `${path}.expected_revision`, 1),
  };
}
