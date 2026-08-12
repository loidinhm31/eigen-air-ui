import type {
  TaskProgressProjectionStatus,
  TaskProgressSnapshotDto,
  TaskProgressUpdatePayload,
  TaskProgressVerificationStatus,
  TaskProgressWsEvent,
} from "./task-progress.js";

export interface TaskProgressCursor {
  artifact_revision: number;
  artifact_event_seq: number;
  snapshot_seq: number;
}

export type TaskProgressUpdateDisposition = "apply" | "ignore" | "refetch";

const PROJECTION_STATUSES = new Set<TaskProgressProjectionStatus>([
  "queued",
  "running",
  "blocked",
  "partial",
  "cancel_requested",
  "cancelled",
  "failed",
  "succeeded",
]);
const VERIFICATION_STATUSES = new Set<TaskProgressVerificationStatus>([
  "unverified",
  "verified_success",
  "verified_failure",
]);

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} must be a non-empty string`);
  return value;
}

function number(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value as number;
}

function status<T extends string>(value: unknown, valid: Set<T>, name: string): T {
  if (typeof value !== "string" || !valid.has(value as T)) throw new Error(`${name} is invalid`);
  return value as T;
}

function updatePayload(value: unknown): TaskProgressUpdatePayload {
  const payload = object(value, "task progress payload");
  const refetch = payload.snapshot_refetch_required === true;
  if (payload.snapshot_refetch_required !== undefined && !refetch) {
    throw new Error("snapshot_refetch_required must be true when present");
  }
  if (refetch && payload.snapshot_seq !== undefined)
    throw new Error("refetch hint must omit snapshot_seq");
  const snapshotSeq = refetch ? undefined : number(payload.snapshot_seq, "snapshot_seq");
  return {
    artifact_id: string(payload.artifact_id, "artifact_id"),
    task_id: string(payload.task_id, "task_id"),
    subagent_run_id: string(payload.subagent_run_id, "subagent_run_id"),
    artifact_revision: number(payload.artifact_revision, "artifact_revision"),
    artifact_event_seq: number(payload.artifact_event_seq, "artifact_event_seq"),
    projection_status: status(payload.projection_status, PROJECTION_STATUSES, "projection_status"),
    verification_status: status(
      payload.verification_status,
      VERIFICATION_STATUSES,
      "verification_status"
    ),
    ...(snapshotSeq === undefined ? {} : { snapshot_seq: snapshotSeq }),
    ...(refetch ? { snapshot_refetch_required: true } : {}),
  };
}

/** Decode only the additive, metadata-only G6 WS v1 event. */
export function decodeTaskProgressWsEvent(value: unknown): TaskProgressWsEvent {
  const frame = object(value, "task progress event");
  if (frame.type !== "event" || frame.version !== "v1" || frame.event !== "task_progress.updated") {
    throw new Error("invalid task progress event envelope");
  }
  const payload = updatePayload(frame.payload);
  if (payload.snapshot_refetch_required)
    return { type: "event", version: "v1", event: "task_progress.updated", payload };

  const eventSeq = number(frame.event_seq, "event_seq");
  if (payload.snapshot_seq !== eventSeq) throw new Error("snapshot_seq must match event_seq");
  return {
    type: "event",
    version: "v1",
    event: "task_progress.updated",
    payload,
    event_id: string(frame.event_id, "event_id"),
    event_seq: eventSeq,
    occurred_at_ms: number(frame.occurred_at_ms, "occurred_at_ms"),
    request_id: string(frame.request_id, "request_id"),
    session_id: string(frame.session_id, "session_id"),
    run_id: string(frame.run_id, "run_id"),
    trace_id: string(frame.trace_id, "trace_id"),
    parent_run_id: string(frame.parent_run_id, "parent_run_id"),
    root_run_id: string(frame.root_run_id, "root_run_id"),
  };
}

/** Decode the authorized, redacted REST task-progress projection. */
export function decodeTaskProgressSnapshot(value: unknown): TaskProgressSnapshotDto {
  const snapshot = object(value, "task progress snapshot");
  const redaction = object(snapshot.redaction, "redaction");
  if (
    snapshot.artifact_type !== "task_progress" ||
    snapshot.schema_version !== 1 ||
    redaction.metadata_only !== true ||
    !Array.isArray(redaction.hidden_fields)
  ) {
    throw new Error("invalid task progress snapshot envelope");
  }
  return {
    artifact_type: "task_progress",
    schema_version: 1,
    artifact_id: string(snapshot.artifact_id, "artifact_id"),
    root_session_id: string(snapshot.root_session_id, "root_session_id"),
    task_id: string(snapshot.task_id, "task_id"),
    subagent_run_id: string(snapshot.subagent_run_id, "subagent_run_id"),
    run_id: string(snapshot.run_id, "run_id"),
    trace_id: string(snapshot.trace_id, "trace_id"),
    parent_run_id: string(snapshot.parent_run_id, "parent_run_id"),
    root_run_id: string(snapshot.root_run_id, "root_run_id"),
    projection_status: status(snapshot.projection_status, PROJECTION_STATUSES, "projection_status"),
    verification_status: status(
      snapshot.verification_status,
      VERIFICATION_STATUSES,
      "verification_status"
    ),
    artifact_revision: number(snapshot.artifact_revision, "artifact_revision"),
    artifact_event_seq: number(snapshot.artifact_event_seq, "artifact_event_seq"),
    g2_snapshot_seq: number(snapshot.g2_snapshot_seq, "g2_snapshot_seq"),
    claimed_active_count: number(snapshot.claimed_active_count, "claimed_active_count"),
    claimed_item_count: number(snapshot.claimed_item_count, "claimed_item_count"),
    updated_at_ms: number(snapshot.updated_at_ms, "updated_at_ms"),
    terminal_at_ms:
      snapshot.terminal_at_ms === null ? null : number(snapshot.terminal_at_ms, "terminal_at_ms"),
    redaction: {
      metadata_only: true,
      hidden_fields: redaction.hidden_fields.map((field) => string(field, "hidden field")),
    },
  };
}

/** Apply only the next update after the authorized REST cursor. */
export function classifyTaskProgressUpdate(
  current: TaskProgressCursor,
  update: TaskProgressWsEvent
): TaskProgressUpdateDisposition {
  if (update.payload.snapshot_refetch_required) return "refetch";
  const next = update.payload;
  if (
    next.artifact_revision === current.artifact_revision &&
    next.artifact_event_seq === current.artifact_event_seq &&
    next.snapshot_seq === current.snapshot_seq
  )
    return "ignore";
  if (
    next.artifact_revision !== current.artifact_revision + 1 ||
    next.artifact_event_seq !== current.artifact_event_seq + 1 ||
    next.snapshot_seq !== current.snapshot_seq + 1
  )
    return "refetch";
  return "apply";
}
