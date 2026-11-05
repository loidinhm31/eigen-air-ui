import type {
  ChatDebugData,
  ChatMessage,
  MemorySearchResult,
  RunLifecycleStatus,
  ServerConfig,
  Session,
  Skill,
  SkillSearchResult,
} from "./api.js";
import type { TaskProgressWsEvent } from "./task-progress.js";
import type { ImageArtifactCommittedPayload, ImageJobUpdatedPayload } from "./artifact.js";
import type {
  ChatCompletedResponse,
  ChatWaitingForInputResponse,
  UserQuestionUpdatedEvent,
} from "./user-question.js";
import type { ToolApprovalUpdatedEvent } from "./tool-approval.js";
import type { ProviderReadinessSnapshot } from "./readiness.js";
import type {
  ExecutionTarget,
  ExecutionTargetInput,
  HostRecoveryStatus,
  InferenceOperationProgressEvent,
  RunInferenceProgressEvent,
} from "./inference.js";

// --- Frame types ---

export interface WsReq<P = Record<string, unknown>> {
  type: "req";
  version: "v1";
  id: string;
  method: string;
  params: P;
}

export interface WsRes<D = unknown> {
  type: "res";
  version?: "v1";
  id: string;
  ok: boolean;
  data?: D;
  error?: { code: string; message: string };
}

// --- Streaming event payloads ---

export interface DebugRequest {
  include_prompt: boolean;
  include_reasoning: boolean;
}

export interface RunStartedPayload {
  run_id?: string;
  debug?: ChatDebugData;
}

export interface ChunkPayload {
  content: string;
}

export interface RunDeltaPayload {
  delta: string;
  snapshot_refetch_required?: boolean;
}

export interface RunReasoningDeltaPayload {
  delta: string;
}

export interface ToolCallPayload {
  id: string;
  tool_call_id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  id: string;
  name: string;
  result: string;
}

export interface RunCompletedPayload {
  run_id?: string;
  content: string;
  tool_calls_made: number;
  tool_limit_reached?: boolean;
  can_continue?: boolean;
  debug?: ChatDebugData;
  lifecycle_status?: RunLifecycleStatus;
  snapshot_seq?: number;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

// --- Discriminated union on event field ---

export interface RunCorrelationFields {
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

type CorrelatedWsEvent<E extends string, P> = {
  type: "event";
  version?: "v1";
  event: E;
  payload: P;
} & RunCorrelationFields;

/**
 * Metadata-only local-image hints (refetch signals, never authority). The backend always sends
 * top-level `session_id`/`run_id` for these frames; they carry no sequence/correlation ids.
 */
export type ImageJobUpdatedWsEvent = CorrelatedWsEvent<
  "image_job.updated",
  ImageJobUpdatedPayload
> & {
  session_id: string;
  run_id: string;
};
export type ImageArtifactCommittedWsEvent = CorrelatedWsEvent<
  "image_artifact.committed",
  ImageArtifactCommittedPayload
> & { session_id: string; run_id: string };
/** Discriminated on `event`. */
export type ImageHintWsEvent = ImageJobUpdatedWsEvent | ImageArtifactCommittedWsEvent;
export interface InferenceHostUpdatedPayload {
  host_id: string;
  revision?: number;
  is_connected?: boolean;
  lease_valid?: boolean;
  recovery?: HostRecoveryStatus;
}

export interface InferenceBindingUpdatedPayload {
  host_id: string;
  pool_id: string;
  revision: number;
  state: string;
}

export interface InferencePoolUpdatedPayload {
  pool_id: string;
  revision?: number;
  ready_hosts?: number;
  busy_hosts?: number;
  offline_hosts?: number;
}

export interface InferenceRecoveryUpdatedPayload {
  request_id: string;
  host_id: string;
  status: string;
  approval_revision?: number;
}

export type InferenceOperationUpdatedPayload =
  | InferenceOperationProgressEvent
  | {
      operation_id: string;
      host_id?: string;
      state?: string;
      revision?: number;
    };

export type InferenceHostUpdatedWsEvent = CorrelatedWsEvent<
  "inference.host.updated",
  InferenceHostUpdatedPayload
>;

export type InferenceBindingUpdatedWsEvent = CorrelatedWsEvent<
  "inference.binding.updated",
  InferenceBindingUpdatedPayload
>;

export type InferencePoolUpdatedWsEvent = CorrelatedWsEvent<
  "inference.pool.updated",
  InferencePoolUpdatedPayload
>;

export type InferenceRecoveryUpdatedWsEvent = CorrelatedWsEvent<
  "inference.recovery.updated",
  InferenceRecoveryUpdatedPayload
>;

export type InferenceOperationUpdatedWsEvent = CorrelatedWsEvent<
  "inference.operation.updated",
  InferenceOperationUpdatedPayload
>;

export type RunInferenceProgressWsEvent = CorrelatedWsEvent<
  "run.inference.progress",
  RunInferenceProgressEvent
>;


export type WsEvent =
  | CorrelatedWsEvent<"run.started", RunStartedPayload>
  | CorrelatedWsEvent<"chunk", ChunkPayload>
  | CorrelatedWsEvent<"run.delta", RunDeltaPayload>
  | CorrelatedWsEvent<"run.reasoning_delta", RunReasoningDeltaPayload>
  | CorrelatedWsEvent<"tool.call", ToolCallPayload>
  | CorrelatedWsEvent<"tool.started", ToolCallPayload>
  | CorrelatedWsEvent<"tool.result", ToolResultPayload>
  | CorrelatedWsEvent<"tool.finished", ToolResultPayload>
  | CorrelatedWsEvent<"run.completed", RunCompletedPayload>
  | CorrelatedWsEvent<"run.finished", RunCompletedPayload>
  | TaskProgressWsEvent
  | UserQuestionUpdatedEvent
  | ToolApprovalUpdatedEvent
  | ImageHintWsEvent
  | InferenceHostUpdatedWsEvent
  | InferenceBindingUpdatedWsEvent
  | InferencePoolUpdatedWsEvent
  | InferenceRecoveryUpdatedWsEvent
  | InferenceOperationUpdatedWsEvent
  | RunInferenceProgressWsEvent
  | CorrelatedWsEvent<"error", WsErrorPayload>;

export type WsFrame = WsReq | WsRes | WsEvent;

// --- Method param types ---

export interface ConnectParams {
  token?: string;
}

export interface ChatSendParams {
  message: string;
  stream?: boolean;
  session_id?: string;
  selected_skill_id?: string;
  selected_skill_install_id?: string;
  selected_skill_content_revision?: string;
  allow_tool_limit_continue?: boolean;
  debug?: DebugRequest;
}

export interface ChatHistoryParams {
  session_id?: string;
  debug?: DebugRequest;
}

export interface ChatAbortParams {
  run_id?: string;
}

export interface SessionsListParams {
  limit?: number;
  cursor?: string;
}

export interface SessionsGetParams {
  id: string;
}

export interface SessionsDeleteParams {
  id: string;
}

export interface SkillsSearchParams {
  query: string;
}

export interface MemorySearchParams {
  query: string;
}

// --- Method response data types ---

export interface ConnectResponse {
  session_id: string;
  agent: string;
  version: string;
}

export interface AgentStatusResponse {
  status: string;
  model: string;
  uptime_secs: number;
  memory_count: number;
  readiness?: ProviderReadinessSnapshot;
}

export type ChatSendResponse = ChatCompletedResponse | ChatWaitingForInputResponse;

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

export interface ChatAbortResponse {
  aborted: boolean;
  aborted_count: number;
  run_ids: string[];
}

export interface SessionsListResponse {
  sessions: Session[];
  next_cursor: string | null;
}

export interface SessionsGetResponse {
  session: Session;
}

export interface SessionsCreateParams {
  execution_target?: ExecutionTargetInput;
  inference_target?: ExecutionTargetInput;
}

export interface SessionsCreateResponse {
  id: string;
  channel: string;
  status: string;
  title?: string | null;
  started_at: number;
  updated_at: number;
  execution_target?: ExecutionTarget;
  inference_target?: ExecutionTarget;
}

export interface SessionsDeleteResponse {
  deleted: boolean;
}

export interface SkillsListResponse {
  skills: Skill[];
}

export interface SkillsSearchResponse {
  results: SkillSearchResult[];
}

export interface MemorySearchWsResponse {
  results: MemorySearchResult[];
}

export type ConfigGetResponse = ServerConfig;
