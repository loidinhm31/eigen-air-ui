import type { TaskOutcomeDto, TaskOutcomeReason, TaskOutcomeStatus } from "./api.js";

export const TASK_OUTCOME_SCHEMA = "task_outcome.v1";
export const MAX_TASK_ID_BYTES = 128;
export const MAX_CHECKER_ID_BYTES = 64;
export const MAX_CHECKER_VERSION_BYTES = 32;
export const MAX_ARTIFACT_PATH_BYTES = 256;
export const MAX_DETAILS_BYTES = 256;

const ALLOWED_KEYS: Record<string, true> = {
  schema_version: true,
  task_id: true,
  checker_id: true,
  checker_version: true,
  artifact_path: true,
  artifact_digest: true,
  status: true,
  reason: true,
  details: true,
  evaluated_at_ms: true,
};

const VALID_STATUSES: Record<TaskOutcomeStatus, true> = {
  passed: true,
  failed: true,
  error: true,
};

const VALID_REASONS: Record<TaskOutcomeReason, true> = {
  valid: true,
  schema_mismatch: true,
  missing_required_field: true,
  unreferenced_citation: true,
  quote_too_short: true,
  source_count_floor_not_met: true,
  artifact_missing: true,
  artifact_oversized: true,
  workspace_violation: true,
  io_error: true,
};

export function decodeTaskOutcome(value: unknown): TaskOutcomeDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Reject arbitrary metadata / extra keys
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS[key]) {
      return null;
    }
  }

  if (record.schema_version !== TASK_OUTCOME_SCHEMA) {
    return null;
  }

  if (
    typeof record.task_id !== "string" ||
    record.task_id.length === 0 ||
    new TextEncoder().encode(record.task_id).length > MAX_TASK_ID_BYTES
  ) {
    return null;
  }

  if (
    typeof record.checker_id !== "string" ||
    record.checker_id.length === 0 ||
    new TextEncoder().encode(record.checker_id).length > MAX_CHECKER_ID_BYTES
  ) {
    return null;
  }

  if (
    typeof record.checker_version !== "string" ||
    record.checker_version.length === 0 ||
    new TextEncoder().encode(record.checker_version).length > MAX_CHECKER_VERSION_BYTES
  ) {
    return null;
  }

  if (
    typeof record.artifact_path !== "string" ||
    new TextEncoder().encode(record.artifact_path).length > MAX_ARTIFACT_PATH_BYTES
  ) {
    return null;
  }

  if (typeof record.artifact_digest !== "string") {
    return null;
  }

  const status = record.status as TaskOutcomeStatus;
  if (!VALID_STATUSES[status]) {
    return null;
  }

  const reason = record.reason as TaskOutcomeReason;
  if (!VALID_REASONS[reason]) {
    return null;
  }

  if (status === "passed") {
    if (record.artifact_digest.length !== 64 || reason !== "valid") {
      return null;
    }
  }

  let details: string | null = null;
  if (record.details !== undefined && record.details !== null) {
    if (
      typeof record.details !== "string" ||
      new TextEncoder().encode(record.details).length > MAX_DETAILS_BYTES
    ) {
      return null;
    }
    details = record.details;
  }

  if (
    typeof record.evaluated_at_ms !== "number" ||
    !Number.isFinite(record.evaluated_at_ms) ||
    record.evaluated_at_ms < 0
  ) {
    return null;
  }

  return {
    schema_version: TASK_OUTCOME_SCHEMA,
    task_id: record.task_id,
    checker_id: record.checker_id,
    checker_version: record.checker_version,
    artifact_path: record.artifact_path,
    artifact_digest: record.artifact_digest,
    status,
    reason,
    details,
    evaluated_at_ms: record.evaluated_at_ms,
  };
}
