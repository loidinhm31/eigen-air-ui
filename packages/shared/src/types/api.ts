// --- Chat ---

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
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
  created_at: string;
  message_count?: number;
}

// --- Memory ---

/** GET /v1/memory — returns list of keys only */
export type MemoryKeyList = string[];

export interface MemoryEntry {
  key: string;
  value: string;
}

export interface MemorySearchResult {
  key: string;
  value: string;
  snippet: string;
}

export interface MemoryStoreRequest {
  key: string;
  value: string;
}

export interface MemoryStoreResponse {
  key: string;
  stored: boolean;
}

export interface MemoryDeleteResponse {
  key: string;
  deleted: boolean;
}

// --- Skill ---

export interface Skill {
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

// --- Errors ---

export interface ApiError {
  error: string;
  message: string;
}
