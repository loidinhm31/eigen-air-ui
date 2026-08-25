export const USER_QUESTION_SCHEMA = "user_question.v1" as const;

export type UserQuestionKind = "single_choice" | "short_text" | "multiline";

export type UserQuestionState =
  | "pending"
  | "answered"
  | "continuing"
  | "resolved"
  | "expired"
  | "cancelled"
  | "aborted"
  | "failed";

export interface UserQuestionOption {
  id: string;
  label: string;
}

export interface SingleChoiceQuestion {
  kind: "single_choice";
  prompt: string;
  help?: string;
  options: UserQuestionOption[];
}

export interface ShortTextQuestion {
  kind: "short_text";
  prompt: string;
  help?: string;
}

export interface MultilineQuestion {
  kind: "multiline";
  prompt: string;
  help?: string;
}

export type UserQuestionRequest =
  | SingleChoiceQuestion
  | ShortTextQuestion
  | MultilineQuestion;

export type UserQuestionAnswer =
  | { kind: "single_choice"; option_id: string }
  | { kind: "short_text"; text: string }
  | { kind: "multiline"; text: string };

export interface UserQuestionMetadata {
  schema_version: typeof USER_QUESTION_SCHEMA;
  question_id: string;
  tenant_id: string;
  user_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  turn_index: number;
  state: UserQuestionState;
  revision: number;
  created_at_ms: number;
  expires_at_ms: number;
  terminal_at_ms: number | null;
  redaction: "metadata_only";
}

export interface UserQuestionSnapshot extends UserQuestionMetadata {
  request?: UserQuestionRequest;
  /** Present only in an owner-authorized pending detail response. */
  mutation_token?: string;
}

export interface UserQuestionListResponse {
  schema_version: typeof USER_QUESTION_SCHEMA;
  questions: UserQuestionMetadata[];
  redaction: "metadata_only";
}

export interface UserQuestionMutationResponse {
  schema_version: typeof USER_QUESTION_SCHEMA;
  question: UserQuestionMetadata;
  status: "accepted";
}

export interface UserQuestionUpdatedEvent {
  type: "event";
  version: "v1";
  event: "user_question.updated";
  payload: {
    question_id: string;
    state: UserQuestionState;
    revision: number;
    kind?: UserQuestionKind;
    redaction?: "metadata_only";
    snapshot_seq?: number;
    snapshot_refetch_required?: true;
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

export interface ChatWaitingForInputResponse {
  status: "waiting_for_input";
  run_id: string;
  question_id: string;
  snapshot_ref: string;
}

export interface ChatCompletedResponse {
  content: string;
  tool_calls_made: number;
  tool_limit_reached?: boolean;
  can_continue?: boolean;
  memory_updated?: boolean;
  memory_reason?: string;
  episode_id?: string | null;
  message_id?: string | null;
  fact_count?: number;
  debug?: import("./api.js").ChatDebugData;
}

export type UserQuestionHttpErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable"
  | "aborted";
