// Strict decoders for local-image WS metadata hints (refetch signals only; never authority).
import {
  IMAGE_JOB_STATES,
  IMAGE_MAX_COUNT,
  IMAGE_MIN_COUNT,
  IMAGE_SAFE_CODES,
  type ImageArtifactCommittedPayload,
  type ImageJobUpdatedPayload,
} from "./artifact.js";
import {
  ARTIFACT_STATES,
  exact,
  fail,
  has,
  id,
  int,
  literal,
  oneOf,
  rec,
  type Rec,
} from "./artifact-decoder-primitives.js";
import type {
  ImageArtifactCommittedWsEvent,
  ImageHintWsEvent,
  ImageJobUpdatedWsEvent,
} from "./ws.js";

const JOB_UPDATED_KEYS = [
  "job_id",
  "session_id",
  "run_id",
  "state",
  "revision",
  "requested_count",
  "completed_count",
] as const;
const ARTIFACT_COMMITTED_KEYS = ["artifact_id", "job_id", "ordinal", "state", "revision"] as const;
const HINT_FRAME_KEYS = ["type", "version", "event", "session_id", "run_id", "payload"] as const;

function hintFrame(
  value: unknown,
  event: string
): { session_id: string; run_id: string; payload: Rec } {
  const o = rec(value, event);
  exact(o, event, HINT_FRAME_KEYS);
  literal(o.type, "event", `${event}.type`);
  literal(o.version, "v1", `${event}.version`);
  literal(o.event, event, `${event}.event`);
  return {
    session_id: id(o.session_id, `${event}.session_id`),
    run_id: id(o.run_id, `${event}.run_id`),
    payload: rec(o.payload, `${event}.payload`),
  };
}

export function decodeImageJobUpdatedEvent(value: unknown): ImageJobUpdatedWsEvent {
  const event = "image_job.updated";
  const frame = hintFrame(value, event);
  const p = frame.payload;
  const path = `${event}.payload`;
  exact(p, path, JOB_UPDATED_KEYS, ["safe_code"]);
  // Payload scope must equal the frame scope.
  if (p.session_id !== frame.session_id || p.run_id !== frame.run_id) fail(`${path}.session_id`);
  const requested_count = int(
    p.requested_count,
    `${path}.requested_count`,
    IMAGE_MIN_COUNT,
    IMAGE_MAX_COUNT
  );
  const payload: ImageJobUpdatedPayload = {
    job_id: id(p.job_id, `${path}.job_id`),
    session_id: frame.session_id,
    run_id: frame.run_id,
    state: oneOf(p.state, IMAGE_JOB_STATES, `${path}.state`),
    revision: int(p.revision, `${path}.revision`, 1),
    requested_count,
    completed_count: int(p.completed_count, `${path}.completed_count`, 0, requested_count),
  };
  if (has(p, "safe_code"))
    payload.safe_code = oneOf(p.safe_code, IMAGE_SAFE_CODES, `${path}.safe_code`);
  return {
    type: "event",
    version: "v1",
    event,
    session_id: frame.session_id,
    run_id: frame.run_id,
    payload,
  };
}

export function decodeImageArtifactCommittedEvent(value: unknown): ImageArtifactCommittedWsEvent {
  const event = "image_artifact.committed";
  const frame = hintFrame(value, event);
  const p = frame.payload;
  const path = `${event}.payload`;
  exact(p, path, ARTIFACT_COMMITTED_KEYS);
  const payload: ImageArtifactCommittedPayload = {
    artifact_id: id(p.artifact_id, `${path}.artifact_id`),
    job_id: id(p.job_id, `${path}.job_id`),
    ordinal: int(p.ordinal, `${path}.ordinal`, 0, IMAGE_MAX_COUNT - 1),
    state: oneOf(p.state, ARTIFACT_STATES, `${path}.state`),
    revision: int(p.revision, `${path}.revision`, 1),
  };
  return {
    type: "event",
    version: "v1",
    event,
    session_id: frame.session_id,
    run_id: frame.run_id,
    payload,
  };
}

export function isImageHintEventName(name: unknown): name is ImageHintWsEvent["event"] {
  return name === "image_job.updated" || name === "image_artifact.committed";
}

/** Decode either hint frame, discriminated on `event`. Unknown event names throw. */
export function decodeImageHintWsEvent(value: unknown): ImageHintWsEvent {
  const name = typeof value === "object" && value !== null ? (value as Rec).event : undefined;
  if (name === "image_job.updated") return decodeImageJobUpdatedEvent(value);
  if (name === "image_artifact.committed") return decodeImageArtifactCommittedEvent(value);
  return fail("image_hint.event");
}
