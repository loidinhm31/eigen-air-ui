export const TOOL_APPROVAL_SCHEMA = "tool_approval.v1" as const;

export type ToolApprovalState =
  | "pending"
  | "approved_once"
  | "claimed"
  | "executing"
  | "consumed"
  | "denied"
  | "expired"
  | "cancelled"
  | "indeterminate";

export type ToolApprovalTerminalCode =
  | "consumed"
  | "approval_denied"
  | "approval_expired"
  | "approval_cancelled"
  | "approval_binding_drift"
  | "approval_policy_drift"
  | "approval_safe_summary_unavailable"
  | "approval_resolver_unavailable"
  | "approval_store_mismatch"
  | "approval_config_mismatch"
  | "approval_backend_unsupported"
  | "approval_conflict"
  | "approval_indeterminate";

export interface ToolApprovalProgramSafeSummary {
  program: string;
  args_count: number;
  working_dir: string;
}

export interface ToolApprovalTemplateSafeSummary {
  tool_name: string;
  template_preview: string;
  param_names: string[];
  working_dir: string;
}

export type ToolApprovalSafeSummary =
  | ToolApprovalProgramSafeSummary
  | ToolApprovalTemplateSafeSummary;

export interface ToolApprovalSnapshot {
  approval_id: string;
  schema_version: typeof TOOL_APPROVAL_SCHEMA;
  tenant_id: string;
  user_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string;
  ordinal: number;
  tool_name: string;
  operation: string;
  risk: "high";
  state: ToolApprovalState;
  safe_summary: ToolApprovalSafeSummary;
  binding_digest: string;
  revision: number;
  created_at_ms: number;
  expires_at_ms: number;
  terminal_at_ms: number | null;
  terminal_code: string | null;
  decision_by_credential_id: string | null;
  redaction: "metadata_only";
}

export interface ToolApprovalListResponse {
  schema_version: typeof TOOL_APPROVAL_SCHEMA;
  approvals: ToolApprovalSnapshot[];
  redaction: "metadata_only";
}

export interface ToolApprovalDetailResponse {
  schema_version: typeof TOOL_APPROVAL_SCHEMA;
  approval: ToolApprovalSnapshot;
  redaction: "metadata_only";
}

export type ToolApprovalResolveDecision = "allow_once" | "deny";

export interface ToolApprovalResolveMutationRequest {
  expected_revision: number;
  decision: ToolApprovalResolveDecision;
  reason?: string;
}

export interface ToolApprovalUpdatedEvent {
  type: "event";
  version?: "v1";
  event: "tool_approval.updated";
  payload: {
    approval_id: string;
    tool_call_id: string;
    tool_name: string;
    state: ToolApprovalState;
    revision: number;
    redaction: "metadata_only";
    snapshot_refetch_required?: boolean;
  };
  session_id?: string;
  run_id?: string;
  request_id?: string;
  event_id?: string;
  event_seq?: number;
  occurred_at_ms?: number;
  trace_id?: string;
  parent_run_id?: string;
  root_run_id?: string;
}

export type ToolApprovalHttpErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable"
  | "aborted";
