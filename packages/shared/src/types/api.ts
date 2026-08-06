// --- Chat ---

export type MessageRole = "user" | "assistant" | "system";

export interface ChatDebugSkill {
  name: string;
  score: number;
}

export interface ChatDebugReasoning {
  requested: boolean;
  available: boolean;
  text?: string | null;
}

export interface ChatDebugData {
  provider: string;
  model: string;
  active_skill?: ChatDebugSkill | null;
  system_prompt?: string | null;
  reasoning?: ChatDebugReasoning | null;
}

export interface ChatMessage {
  id?: string;
  role: MessageRole;
  content: string;
  debug?: ChatDebugData;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  session_id?: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
}

// --- Agent ---

export interface Agent {
  id: string;
  name: string;
  model: string;
  status?: "idle" | "running" | "error";
  uptime_secs?: number;
}

export interface AgentCreateRequest {
  name: string;
  model: string;
}

export interface AgentCreateResponse {
  id: string;
  name: string;
  model: string;
}

export interface AgentUpdateRequest {
  model: string;
}

// --- Session ---

export interface Session {
  id: string;
  channel: string;
  status: string;
  title?: string | null;
  started_at: number;
  updated_at: number;
  message_count?: number;
}

// --- Memory ---

/** GET /v1/memory — returns list of keys only */
export type MemoryKeyList = string[];

export interface MemoryEntry {
  key: string;
  value: unknown;
}

export interface MemorySearchResult {
  key: string;
  value: unknown;
  snippet: string;
}

export interface MemoryStoreRequest {
  key: string;
  value: unknown;
}

export interface MemoryStoreResponse {
  key: string;
  stored: boolean;
}

export interface MemoryDeleteResponse {
  key: string;
  deleted: boolean;
}

// --- Vault ---

export interface MemoryScope {
  tenant_id: string;
  user_id: string;
  session_id?: string | null;
  agent_id: string;
}

export interface VaultItem {
  id: string;
  scope: MemoryScope;
  name: string;
  media_type: string;
  content: unknown;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface VaultItemRequest {
  name: string;
  media_type?: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

// --- Knowledge ---

export interface KnowledgeFact {
  id: string;
  source_episode_id: string;
  scope: MemoryScope;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface EpisodicMemory {
  id: string;
  scope: MemoryScope;
  input: string;
  output: string;
  summary: string;
  debug?: ChatDebugData | null;
  created_at: number;
}

export interface EpisodeUpdate {
  input?: string;
  output?: string;
  summary?: string;
}

export interface KnowledgeRelation {
  id: string;
  scope: MemoryScope;
  source: string;
  relation_type: string;
  target: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface KnowledgeRelationRequest {
  source: string;
  relation_type: string;
  target: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// --- Skill ---

export interface Skill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
}

export interface SkillSearchResult {
  name: string;
  description: string;
  score: number;
}

// --- Tool ---

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolInvokeRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolInvokeResult {
  name: string;
  result: string;
}

// --- Config ---

export interface ServerConfig {
  provider: { type: string; model: string };
  memory: { type: string };
  server: { host: string; port: number };
  security: { allow_shell: boolean; max_tool_calls_per_turn: number };
}

// --- Health ---

export interface HealthStatus {
  status: "ok" | "error";
  version: string;
}

// --- Run observability (G2) ---

export type RunLifecycleStatus = "running" | "completed" | "failed" | "skipped" | "aborted";
export type RunUsageOrigin = "reported" | "estimated" | "unknown";
export type RunPolicyOutcome = "allowed" | "denied" | "not_applicable";
export type RunToolCallStatus = "requested" | "running" | "completed" | "failed" | "denied" | "skipped";
export type RunMemoryKind = "working" | "episode" | "fact";
export type RunDebugExcerptKind =
  | "user_request"
  | "system_prompt"
  | "provider_reasoning"
  | "provider_response"
  | "tool_arguments"
  | "tool_result";

export interface RunRedactionDto {
  metadata_only: boolean;
  debug_requested: boolean;
  debug_available: boolean;
  unavailable_reason?: "disabled" | "unauthorized" | "expired" | "key_unavailable" | "invalid" | null;
}

export interface RunUsageDto {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  origin: RunUsageOrigin;
}

export interface RunSummaryDto {
  run_id: string;
  trace_id: string;
  request_id?: string | null;
  session_id: string;
  parent_run_id?: string | null;
  root_run_id: string;
  tenant_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  provider_id: string;
  channel: string;
  lifecycle_status: RunLifecycleStatus;
  started_at_ms: number;
  updated_at_ms: number;
  completed_at_ms?: number | null;
  snapshot_seq: number;
  correlation_state: string;
  redaction: RunRedactionDto;
  usage?: RunUsageDto | null;
}

export interface RunEventDto {
  event_id: string;
  event_seq: number;
  event_kind: string;
  lifecycle_status?: RunLifecycleStatus | null;
  occurred_at_ms: number;
  safe_error_code?: string | null;
  policy_outcome?: RunPolicyOutcome | null;
}

export interface RunToolCallDto {
  tool_call_id: string;
  ordinal: number;
  tool_name: string;
  status: RunToolCallStatus;
  policy_outcome?: RunPolicyOutcome | null;
  started_at_ms: number;
  completed_at_ms?: number | null;
  safe_error_code?: string | null;
}

export interface RunMemoryLineageDto {
  lineage_seq: number;
  relation: "considered" | "used" | "written";
  memory_kind: RunMemoryKind;
  memory_reference: string;
  tenant_id: string;
  user_id: string;
  workspace_id: string;
  agent_id: string;
  source_episode_id?: string | null;
  provenance?: string | null;
  confidence?: number | null;
  occurred_at_ms: number;
}

/** Sensitive, request-time plaintext. This must only live in runInspectorStore. */
export interface RunDebugExcerptDto {
  excerpt_seq: number;
  kind: RunDebugExcerptKind;
  plaintext: string;
  created_at_ms: number;
  expires_at_ms: number;
  plaintext_bytes: number;
  truncated: boolean;
  redaction_count: number;
}

export interface RunSnapshotDto {
  schema_version: number;
  run: RunSummaryDto;
  events: RunEventDto[];
  tool_calls: RunToolCallDto[];
  memory_lineage: RunMemoryLineageDto[];
  debug_excerpts?: RunDebugExcerptDto[];
  next_event_cursor?: string | null;
  next_tool_cursor?: string | null;
  next_lineage_cursor?: string | null;
  next_debug_cursor?: string | null;
}

export interface RunListResponseDto {
  schema_version: number;
  runs: RunSummaryDto[];
  next_cursor?: string | null;
}

// --- Errors ---

export interface ApiError {
  error: string;
  message: string;
}
