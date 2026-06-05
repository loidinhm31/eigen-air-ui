import type { ChatMessage, ServerConfig, Session, Skill, SkillSearchResult, MemorySearchResult } from "./api.js";

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
  id: string;
  ok: boolean;
  data?: D;
  error?: { code: string; message: string };
}

// --- Streaming event payloads ---

export interface RunStartedPayload {
  run_id?: string;
}

export interface ChunkPayload {
  content: string;
}

export interface RunDeltaPayload {
  delta: string;
}

export interface ToolCallPayload {
  id: string;
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
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

// --- Discriminated union on event field ---

export type WsEvent =
  | { type: "event"; event: "run.started"; payload: RunStartedPayload }
  | { type: "event"; event: "chunk"; payload: ChunkPayload }
  | { type: "event"; event: "run.delta"; payload: RunDeltaPayload }
  | { type: "event"; event: "tool.call"; payload: ToolCallPayload }
  | { type: "event"; event: "tool.started"; payload: ToolCallPayload }
  | { type: "event"; event: "tool.result"; payload: ToolResultPayload }
  | { type: "event"; event: "tool.finished"; payload: ToolResultPayload }
  | { type: "event"; event: "run.completed"; payload: RunCompletedPayload }
  | { type: "event"; event: "run.finished"; payload: RunCompletedPayload }
  | { type: "event"; event: "error"; payload: WsErrorPayload };

export type WsFrame = WsReq | WsRes | WsEvent;

// --- Method param types ---

export interface ConnectParams {
  token?: string;
}

export interface ChatSendParams {
  message: string;
  stream?: boolean;
  session_id?: string;
}

export interface ChatHistoryParams {
  session_id?: string;
}

export interface ChatAbortParams {
  run_id?: string;
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
}

export interface ChatSendResponse {
  content: string;
  tool_calls_made: number;
}

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
}

export interface SessionsCreateResponse {
  id: string;
  channel: string;
  status: string;
  started_at: number;
  updated_at: number;
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
