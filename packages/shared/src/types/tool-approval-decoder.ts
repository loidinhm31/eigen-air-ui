import type {
  ToolApprovalDetailResponse,
  ToolApprovalHttpErrorKind,
  ToolApprovalListResponse,
  ToolApprovalProgramSafeSummary,
  ToolApprovalResolveDecision,
  ToolApprovalResolveMutationRequest,
  ToolApprovalSafeSummary,
  ToolApprovalSnapshot,
  ToolApprovalState,
  ToolApprovalTemplateSafeSummary,
  ToolApprovalTerminalCode,
  ToolApprovalUpdatedEvent,
} from "./tool-approval.js";
import { TOOL_APPROVAL_SCHEMA } from "./tool-approval.js";

const MAX_SAFE_SUMMARY_BYTES = 512;
const MAX_TEMPLATE_PREVIEW_CHARS = 128;
const MAX_ID_BYTES = 512;
const MAX_TOOL_NAME_BYTES = 256;
const MAX_OPERATION_BYTES = 256;
const MAX_WORKING_DIR_BYTES = 512;
const MAX_PARAM_NAME_BYTES = 128;
const MAX_PARAM_NAMES_COUNT = 64;
const MAX_TOOL_APPROVAL_LIST = 100;

export const FORBIDDEN_REDACTION_KEYS = [
  "arguments",
  "raw_args",
  "env",
  "environment",
  "token",
  "secret",
  "api_key",
  "raw_command",
  "output",
  "tool_output",
  "host_cwd",
  "absolute_cwd",
  "private_digest",
] as const;

export const VALID_APPROVAL_STATES: readonly ToolApprovalState[] = [
  "pending",
  "approved_once",
  "claimed",
  "executing",
  "consumed",
  "denied",
  "expired",
  "cancelled",
  "indeterminate",
];

export const VALID_TERMINAL_CODES: readonly ToolApprovalTerminalCode[] = [
  "consumed",
  "approval_denied",
  "approval_expired",
  "approval_cancelled",
  "approval_binding_drift",
  "approval_policy_drift",
  "approval_safe_summary_unavailable",
  "approval_resolver_unavailable",
  "approval_store_mismatch",
  "approval_config_mismatch",
  "approval_backend_unsupported",
  "approval_conflict",
  "approval_indeterminate",
];

const BINDING_DIGEST_REGEX = /^[0-9a-f]{64}$/;
const BIDI_REGEX = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

export class ToolApprovalDecodeError extends Error {
  constructor(message = "Invalid tool approval response") {
    super(message);
    this.name = "ToolApprovalDecodeError";
  }
}

function fail(message?: string): never {
  throw new ToolApprovalDecodeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === allowed.size && actual.every((key) => allowed.has(key));
}

function hasAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isNonEmptyString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && utf8Bytes(value) <= maxBytes;
}

function isPlainDisplayText(value: unknown, maxBytes: number): value is string {
  if (!isNonEmptyString(value, maxBytes)) return false;
  if (BIDI_REGEX.test(value)) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function isValidWorkingDir(value: unknown): value is string {
  if (!isPlainDisplayText(value, MAX_WORKING_DIR_BYTES)) return false;
  if (value === "workspace_root") return true;
  // Disallow absolute unix paths, windows drive paths, windows UNC paths
  if (value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:[/\\]/.test(value)) {
    return false;
  }
  // Disallow traversal segments
  const segments = value.split(/[/\\]/);
  if (segments.some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
    return false;
  }
  return true;
}

function isValidProgramBasename(value: unknown): value is string {
  if (!isPlainDisplayText(value, MAX_TOOL_NAME_BYTES)) return false;
  if (value.includes("/") || value.includes("\\")) return false;
  return /^[a-zA-Z0-9_.-]+$/.test(value);
}

function isValidIdentifier(value: unknown, maxBytes: number): value is string {
  if (!isPlainDisplayText(value, maxBytes)) return false;
  return /^[a-zA-Z0-9_.-]+$/.test(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isApprovalState(value: unknown): value is ToolApprovalState {
  return typeof value === "string" && VALID_APPROVAL_STATES.includes(value as ToolApprovalState);
}

function containsForbiddenKeys(obj: unknown): boolean {
  if (!isRecord(obj)) return false;
  for (const key of Object.keys(obj)) {
    if ((FORBIDDEN_REDACTION_KEYS as readonly string[]).includes(key.toLowerCase())) {
      return true;
    }
    const val = obj[key];
    if (isRecord(val) && containsForbiddenKeys(val)) {
      return true;
    }
  }
  return false;
}

export function decodeToolApprovalSafeSummary(value: unknown): ToolApprovalSafeSummary {
  if (!isRecord(value)) fail("Safe summary must be an object");
  if (containsForbiddenKeys(value)) fail("Safe summary contains forbidden redaction keys");

  const serialized = JSON.stringify(value);
  if (utf8Bytes(serialized) > MAX_SAFE_SUMMARY_BYTES) {
    fail("Safe summary exceeds max serialized bytes limit of 512");
  }

  const keys = Object.keys(value).sort();
  const programKeys = ["args_count", "program", "working_dir"].sort();
  const templateKeys = ["param_names", "template_preview", "tool_name", "working_dir"].sort();

  if (keys.length === programKeys.length && keys.every((k, i) => k === programKeys[i])) {
    if (!isValidProgramBasename(value.program)) {
      fail("Invalid program field: must be binary basename without path separators or control characters");
    }
    if (!isSafeInteger(value.args_count)) {
      fail("Invalid args_count field");
    }
    if (!isValidWorkingDir(value.working_dir)) {
      fail("Invalid working_dir field: must be workspace_root or normalized workspace-relative path");
    }
    return {
      program: value.program,
      args_count: value.args_count,
      working_dir: value.working_dir,
    } as ToolApprovalProgramSafeSummary;
  }

  if (keys.length === templateKeys.length && keys.every((k, i) => k === templateKeys[i])) {
    if (!isValidIdentifier(value.tool_name, MAX_TOOL_NAME_BYTES)) {
      fail("Invalid tool_name field");
    }
    if (
      typeof value.template_preview !== "string" ||
      utf8Bytes(value.template_preview) > MAX_SAFE_SUMMARY_BYTES ||
      [...value.template_preview].length > MAX_TEMPLATE_PREVIEW_CHARS ||
      !isPlainDisplayText(value.template_preview, MAX_SAFE_SUMMARY_BYTES)
    ) {
      fail("Invalid template_preview field: must be plain display text up to 128 characters");
    }
    if (
      !Array.isArray(value.param_names) ||
      value.param_names.length > MAX_PARAM_NAMES_COUNT ||
      !value.param_names.every((param) => isValidIdentifier(param, MAX_PARAM_NAME_BYTES))
    ) {
      fail("Invalid param_names field: all parameters must be valid identifiers");
    }
    // Check strictly sorted and unique
    const isSortedAndUnique = value.param_names.every(
      (item, idx, arr) => idx === 0 || (arr[idx - 1] as string) < (item as string)
    );
    if (!isSortedAndUnique) {
      fail("param_names must be unique and lexicographically sorted");
    }

    if (!isValidWorkingDir(value.working_dir)) {
      fail("Invalid working_dir field: must be workspace_root or normalized workspace-relative path");
    }
    return {
      tool_name: value.tool_name,
      template_preview: value.template_preview,
      param_names: [...value.param_names],
      working_dir: value.working_dir,
    } as ToolApprovalTemplateSafeSummary;
  }

  fail("Unknown or malformed safe summary key shape");
}

export function decodeToolApprovalSnapshot(value: unknown): ToolApprovalSnapshot {
  if (!isRecord(value)) fail("Snapshot must be an object");
  if (containsForbiddenKeys(value)) fail("Snapshot contains forbidden redaction keys");

  const snapshotKeys = [
    "approval_id",
    "schema_version",
    "tenant_id",
    "user_id",
    "workspace_id",
    "session_id",
    "run_id",
    "tool_call_id",
    "ordinal",
    "tool_name",
    "operation",
    "risk",
    "state",
    "safe_summary",
    "binding_digest",
    "revision",
    "created_at_ms",
    "expires_at_ms",
    "terminal_at_ms",
    "terminal_code",
    "decision_by_credential_id",
    "redaction",
  ] as const;

  if (!hasOnlyKeys(value, snapshotKeys)) {
    fail("Snapshot has extra or missing keys");
  }

  if (value.schema_version !== TOOL_APPROVAL_SCHEMA) {
    fail(`Invalid schema_version: expected ${TOOL_APPROVAL_SCHEMA}`);
  }

  if (!isNonEmptyString(value.approval_id, MAX_ID_BYTES)) fail("Invalid approval_id");
  if (!isNonEmptyString(value.tenant_id, MAX_ID_BYTES)) fail("Invalid tenant_id");
  if (!isNonEmptyString(value.user_id, MAX_ID_BYTES)) fail("Invalid user_id");
  if (!isNonEmptyString(value.workspace_id, MAX_ID_BYTES)) fail("Invalid workspace_id");
  if (!isNonEmptyString(value.session_id, MAX_ID_BYTES)) fail("Invalid session_id");
  if (!isNonEmptyString(value.run_id, MAX_ID_BYTES)) fail("Invalid run_id");
  if (!isNonEmptyString(value.tool_call_id, MAX_ID_BYTES)) fail("Invalid tool_call_id");
  if (!isSafeInteger(value.ordinal)) fail("Invalid ordinal");
  if (!isValidIdentifier(value.tool_name, MAX_TOOL_NAME_BYTES)) fail("Invalid tool_name");
  if (!isValidIdentifier(value.operation, MAX_OPERATION_BYTES)) fail("Invalid operation");
  if (value.risk !== "high") fail("Invalid risk: must be 'high'");
  if (!isApprovalState(value.state)) fail("Invalid state");

  const safe_summary = decodeToolApprovalSafeSummary(value.safe_summary);

  // Consistency check between snapshot.tool_name and safe_summary.tool_name
  if ("tool_name" in safe_summary && safe_summary.tool_name !== value.tool_name) {
    fail("Snapshot tool_name does not match safe_summary tool_name");
  }

  if (
    typeof value.binding_digest !== "string" ||
    !BINDING_DIGEST_REGEX.test(value.binding_digest)
  ) {
    fail("Invalid binding_digest: must be 64 lowercase hex characters");
  }

  if (!isSafeInteger(value.revision)) fail("Invalid revision");
  if (!isSafeInteger(value.created_at_ms)) fail("Invalid created_at_ms");
  if (!isSafeInteger(value.expires_at_ms)) fail("Invalid expires_at_ms");

  if (value.terminal_at_ms !== null && !isSafeInteger(value.terminal_at_ms)) {
    fail("Invalid terminal_at_ms");
  }

  if (
    value.terminal_code !== null &&
    !VALID_TERMINAL_CODES.includes(value.terminal_code as ToolApprovalTerminalCode)
  ) {
    fail("Invalid terminal_code: must be a known safe terminal code or null");
  }

  if (
    value.decision_by_credential_id !== null &&
    !isNonEmptyString(value.decision_by_credential_id, MAX_ID_BYTES)
  ) {
    fail("Invalid decision_by_credential_id");
  }

  if (value.redaction !== "metadata_only") {
    fail("Invalid redaction: must be 'metadata_only'");
  }

  return {
    approval_id: value.approval_id,
    schema_version: TOOL_APPROVAL_SCHEMA,
    tenant_id: value.tenant_id,
    user_id: value.user_id,
    workspace_id: value.workspace_id,
    session_id: value.session_id,
    run_id: value.run_id,
    tool_call_id: value.tool_call_id,
    ordinal: value.ordinal,
    tool_name: value.tool_name,
    operation: value.operation,
    risk: "high",
    state: value.state,
    safe_summary,
    binding_digest: value.binding_digest,
    revision: value.revision,
    created_at_ms: value.created_at_ms,
    expires_at_ms: value.expires_at_ms,
    terminal_at_ms: value.terminal_at_ms,
    terminal_code: value.terminal_code as ToolApprovalTerminalCode | null,
    decision_by_credential_id: value.decision_by_credential_id,
    redaction: "metadata_only",
  };
}

export function decodeToolApprovalListResponse(value: unknown): ToolApprovalListResponse {
  if (!isRecord(value)) fail("List response must be an object");
  if (!hasOnlyKeys(value, ["schema_version", "approvals", "redaction"])) {
    fail("List response has extra or missing keys");
  }

  if (value.schema_version !== TOOL_APPROVAL_SCHEMA) {
    fail(`Invalid schema_version: expected ${TOOL_APPROVAL_SCHEMA}`);
  }
  if (value.redaction !== "metadata_only") {
    fail("Invalid redaction: must be 'metadata_only'");
  }
  if (!Array.isArray(value.approvals)) {
    fail("approvals must be an array");
  }
  if (value.approvals.length > MAX_TOOL_APPROVAL_LIST) {
    fail(`approvals array exceeds max list limit of ${MAX_TOOL_APPROVAL_LIST}`);
  }

  // Reject duplicate approval_id entries
  const seenIds = new Set<string>();
  for (const item of value.approvals) {
    if (isRecord(item) && typeof item.approval_id === "string") {
      if (seenIds.has(item.approval_id)) {
        fail("Duplicate approval_id in list response");
      }
      seenIds.add(item.approval_id);
    }
  }

  const approvals = value.approvals.map((item) => decodeToolApprovalSnapshot(item));

  return {
    schema_version: TOOL_APPROVAL_SCHEMA,
    approvals,
    redaction: "metadata_only",
  };
}

export function decodeToolApprovalDetailResponse(value: unknown): ToolApprovalDetailResponse {
  if (!isRecord(value)) fail("Detail response must be an object");
  if (!hasOnlyKeys(value, ["schema_version", "approval", "redaction"])) {
    fail("Detail response has extra or missing keys");
  }

  if (value.schema_version !== TOOL_APPROVAL_SCHEMA) {
    fail(`Invalid schema_version: expected ${TOOL_APPROVAL_SCHEMA}`);
  }
  if (value.redaction !== "metadata_only") {
    fail("Invalid redaction: must be 'metadata_only'");
  }

  const approval = decodeToolApprovalSnapshot(value.approval);

  return {
    schema_version: TOOL_APPROVAL_SCHEMA,
    approval,
    redaction: "metadata_only",
  };
}

export function decodeToolApprovalResolveMutation(
  value: unknown
): ToolApprovalResolveMutationRequest {
  if (!isRecord(value)) fail("Mutation request must be an object");
  if (!hasOnlyKeys(value, ["expected_revision", "decision"])) {
    fail("Mutation request has unknown or extraneous keys");
  }

  if (!isSafeInteger(value.expected_revision)) {
    fail("Invalid expected_revision");
  }

  if (value.decision !== "allow_once" && value.decision !== "deny") {
    fail("Invalid decision: must be 'allow_once' or 'deny'");
  }

  return {
    expected_revision: value.expected_revision,
    decision: value.decision as ToolApprovalResolveDecision,
  };
}

export function decodeToolApprovalEvent(value: unknown): ToolApprovalUpdatedEvent {
  if (!isRecord(value)) fail("Event must be an object");

  const allowedEnvelopeKeys = [
    "type",
    "version",
    "event",
    "payload",
    "session_id",
    "run_id",
    "request_id",
    "event_id",
    "event_seq",
    "occurred_at_ms",
    "trace_id",
    "parent_run_id",
    "root_run_id",
  ] as const;

  if (!hasAllowedKeys(value, allowedEnvelopeKeys)) {
    fail("Event has unknown envelope keys");
  }

  if (value.type !== "event") fail("Invalid event type: must be 'event'");
  if (value.version !== undefined && value.version !== "v1") {
    fail("Invalid event version: must be 'v1'");
  }
  if (value.event !== "tool_approval.updated") {
    fail("Invalid event: must be 'tool_approval.updated'");
  }

  if (!isRecord(value.payload)) fail("Event payload must be an object");

  const allowedPayloadKeys = [
    "approval_id",
    "tool_call_id",
    "tool_name",
    "state",
    "revision",
    "redaction",
    "snapshot_refetch_required",
  ] as const;

  if (!hasAllowedKeys(value.payload, allowedPayloadKeys)) {
    fail("Event payload has unknown keys");
  }

  const payload = value.payload;

  if (!isNonEmptyString(payload.approval_id, MAX_ID_BYTES)) {
    fail("Invalid payload approval_id");
  }
  if (!isNonEmptyString(payload.tool_call_id, MAX_ID_BYTES)) {
    fail("Invalid payload tool_call_id");
  }
  if (!isValidIdentifier(payload.tool_name, MAX_TOOL_NAME_BYTES)) {
    fail("Invalid payload tool_name");
  }
  if (!isApprovalState(payload.state)) {
    fail("Invalid payload state");
  }
  if (!isSafeInteger(payload.revision)) {
    fail("Invalid payload revision");
  }
  if (payload.redaction !== "metadata_only") {
    fail("Invalid payload redaction: must be 'metadata_only'");
  }
  if (
    payload.snapshot_refetch_required !== undefined &&
    typeof payload.snapshot_refetch_required !== "boolean"
  ) {
    fail("Invalid payload snapshot_refetch_required");
  }

  for (const key of [
    "session_id",
    "run_id",
    "request_id",
    "event_id",
    "trace_id",
    "parent_run_id",
    "root_run_id",
  ] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key], MAX_ID_BYTES)) {
      fail(`Invalid correlation string for ${key}`);
    }
  }

  for (const key of ["event_seq", "occurred_at_ms"] as const) {
    if (value[key] !== undefined && !isSafeInteger(value[key])) {
      fail(`Invalid correlation number for ${key}`);
    }
  }

  return {
    type: "event",
    ...(value.version !== undefined ? { version: "v1" } : {}),
    event: "tool_approval.updated",
    payload: {
      approval_id: payload.approval_id,
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_name,
      state: payload.state,
      revision: payload.revision,
      redaction: "metadata_only",
      ...(payload.snapshot_refetch_required !== undefined
        ? { snapshot_refetch_required: payload.snapshot_refetch_required }
        : {}),
    },
    ...(value.session_id !== undefined ? { session_id: value.session_id as string } : {}),
    ...(value.run_id !== undefined ? { run_id: value.run_id as string } : {}),
    ...(value.request_id !== undefined ? { request_id: value.request_id as string } : {}),
    ...(value.event_id !== undefined ? { event_id: value.event_id as string } : {}),
    ...(value.event_seq !== undefined ? { event_seq: value.event_seq as number } : {}),
    ...(value.occurred_at_ms !== undefined
      ? { occurred_at_ms: value.occurred_at_ms as number }
      : {}),
    ...(value.trace_id !== undefined ? { trace_id: value.trace_id as string } : {}),
    ...(value.parent_run_id !== undefined
      ? { parent_run_id: value.parent_run_id as string }
      : {}),
    ...(value.root_run_id !== undefined ? { root_run_id: value.root_run_id as string } : {}),
  };
}

export function errorKindForToolApprovalStatus(status: number): ToolApprovalHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  if (status === 0) return "aborted";
  return "unavailable";
}
