import type {
  MemoryOperationKind,
  MemoryOutcomeDto,
  MemoryOutcomeReason,
  MemoryOutcomeState,
} from "./api.js";

export const MEMORY_OUTCOME_SCHEMA = "memory_outcome.v1";
export const MAX_OPERATION_ID_BYTES = 128;
export const MAX_EPISODE_REFERENCE_BYTES = 256;
export const MAX_FACT_COUNT = 10_000;

const ALLOWED_KEYS: Record<string, true> = {
  schema_version: true,
  operation_id: true,
  operation_kind: true,
  state: true,
  reason: true,
  episode_reference: true,
  fact_count: true,
};

const VALID_STATES: Record<MemoryOutcomeState, true> = {
  stored: true,
  skipped: true,
  failed: true,
  unavailable: true,
};

const VALID_REASONS: Record<MemoryOutcomeReason, true> = {
  stored: true,
  sensitive_content: true,
  no_identity: true,
  no_final_response: true,
  write_failed: true,
  outcome_unavailable: true,
};

const VALID_OPERATIONS: Record<MemoryOperationKind, true> = {
  episode_flush: true,
};

export function decodeMemoryOutcome(value: unknown): MemoryOutcomeDto | null {
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

  if (record.schema_version !== MEMORY_OUTCOME_SCHEMA) {
    return null;
  }

  if (
    typeof record.operation_id !== "string" ||
    record.operation_id.length === 0 ||
    new TextEncoder().encode(record.operation_id).length > MAX_OPERATION_ID_BYTES ||
    !/^[a-zA-Z0-9_-]+$/.test(record.operation_id)
  ) {
    return null;
  }

  if (
    typeof record.operation_kind !== "string" ||
    !VALID_OPERATIONS[record.operation_kind as MemoryOperationKind]
  ) {
    return null;
  }

  if (
    typeof record.state !== "string" ||
    !VALID_STATES[record.state as MemoryOutcomeState]
  ) {
    return null;
  }

  if (
    typeof record.reason !== "string" ||
    !VALID_REASONS[record.reason as MemoryOutcomeReason]
  ) {
    return null;
  }

  const state = record.state as MemoryOutcomeState;
  const reason = record.reason as MemoryOutcomeReason;

  // Validate state-reason consistency
  switch (state) {
    case "stored":
      if (reason !== "stored") {
        return null;
      }
      break;
    case "skipped":
      if (
        reason !== "sensitive_content" &&
        reason !== "no_identity" &&
        reason !== "no_final_response"
      ) {
        return null;
      }
      if (record.episode_reference !== undefined && record.episode_reference !== null) {
        return null;
      }
      break;
    case "failed":
      if (reason !== "write_failed") {
        return null;
      }
      break;
    case "unavailable":
      if (reason !== "outcome_unavailable") {
        return null;
      }
      if (record.episode_reference !== undefined && record.episode_reference !== null) {
        return null;
      }
      if (record.fact_count !== undefined && record.fact_count !== null) {
        return null;
      }
      break;
  }

  let episode_reference: string | null | undefined = undefined;
  if (record.episode_reference !== undefined && record.episode_reference !== null) {
    if (
      typeof record.episode_reference !== "string" ||
      record.episode_reference.length === 0 ||
      new TextEncoder().encode(record.episode_reference).length > MAX_EPISODE_REFERENCE_BYTES ||
      Array.from(record.episode_reference).some((c) => c <= " " || c === "\x7f")
    ) {
      return null;
    }
    episode_reference = record.episode_reference;
  } else if (record.episode_reference === null) {
    episode_reference = null;
  }

  let fact_count: number | null | undefined = undefined;
  if (record.fact_count !== undefined && record.fact_count !== null) {
    if (
      typeof record.fact_count !== "number" ||
      !Number.isSafeInteger(record.fact_count) ||
      record.fact_count < 0 ||
      record.fact_count > MAX_FACT_COUNT
    ) {
      return null;
    }
    fact_count = record.fact_count;
  } else if (record.fact_count === null) {
    fact_count = null;
  }

  return {
    schema_version: record.schema_version,
    operation_id: record.operation_id,
    operation_kind: record.operation_kind,
    state,
    reason,
    ...(episode_reference !== undefined ? { episode_reference } : {}),
    ...(fact_count !== undefined ? { fact_count } : {}),
  };
}

export function formatMemoryOutcomeState(state: MemoryOutcomeState): string {
  switch (state) {
    case "stored":
      return "Stored";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    case "unavailable":
      return "Unavailable";
    default:
      return state;
  }
}

export function formatMemoryOutcomeReason(reason: MemoryOutcomeReason): string {
  switch (reason) {
    case "stored":
      return "Stored";
    case "sensitive_content":
      return "Sensitive content detected";
    case "no_identity":
      return "No authenticated identity";
    case "no_final_response":
      return "No final assistant response";
    case "write_failed":
      return "Write failed";
    case "outcome_unavailable":
      return "Outcome unavailable";
    default:
      return reason;
  }
}
