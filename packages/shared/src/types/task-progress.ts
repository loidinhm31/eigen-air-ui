export type TaskProgressProjectionStatus =
  | "queued"
  | "running"
  | "blocked"
  | "partial"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "succeeded";

export type TaskProgressVerificationStatus = "unverified" | "verified_success" | "verified_failure";

export interface TaskProgressUpdatePayload {
  artifact_id: string;
  task_id: string;
  subagent_run_id: string;
  artifact_revision: number;
  artifact_event_seq: number;
  projection_status: TaskProgressProjectionStatus;
  verification_status: TaskProgressVerificationStatus;
  snapshot_seq?: number;
  snapshot_refetch_required?: true;
}

export interface TaskProgressWsEvent {
  type: "event";
  version: "v1";
  event: "task_progress.updated";
  payload: TaskProgressUpdatePayload;
  request_id?: string;
  event_id?: string;
  event_seq?: number;
  occurred_at_ms?: number;
  session_id?: string;
  run_id?: string;
  trace_id?: string;
  parent_run_id?: string;
  root_run_id?: string;
}

export interface TaskProgressRedactionDto {
  metadata_only: true;
  hidden_fields: string[];
}

export interface TaskProgressSnapshotDto {
  artifact_type: "task_progress";
  schema_version: 1;
  artifact_id: string;
  root_session_id: string;
  task_id: string;
  subagent_run_id: string;
  run_id: string;
  trace_id: string;
  parent_run_id: string;
  root_run_id: string;
  projection_status: TaskProgressProjectionStatus;
  verification_status: TaskProgressVerificationStatus;
  artifact_revision: number;
  artifact_event_seq: number;
  g2_snapshot_seq: number;
  claimed_active_count: number;
  claimed_item_count: number;
  updated_at_ms: number;
  terminal_at_ms: number | null;
  redaction: TaskProgressRedactionDto;
}
