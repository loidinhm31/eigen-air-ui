# Phase 2: Shared Package

> Parent: [plan.md](./plan.md) | Dependencies: Phase 1 | Blocks: Phases 3–6
> Docs: nonclaw/docs/api-reference.md + websocket-protocol.md

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P1 |
| Effort | ~2h |
| Implementation | done |
| Review | done |
| Completed | 2026-03-28 |

Build `packages/shared` — all TypeScript domain types, WS protocol frame types, HTTP API types, and constants used across the ui package and apps. Zero runtime dependencies beyond `clsx` and `tailwind-merge` for the `cn()` utility.

## Key Insights

- nonclaw-ui is **standalone** — no `AuthResponse`, `SyncRecord`, `SyncConfig`, or `AuthStorageKeys` from the connected pattern. Strip those entirely.
- WS protocol: three frame types (`WsReq`, `WsRes`, `WsEvent`). Streaming events (`chunk`, `tool.call`, `tool.result`, `run.started`, `run.completed`, `error`) are modeled as discriminated unions on `WsEvent`.
- `connectionStore` daemon URL is persisted in `localStorage` using `STORAGE_KEYS.DAEMON_URL`. Default value `http://localhost:18790` lives in constants.
- Keep `ChatMessage` compatible with OpenAI schema (`role: "user" | "assistant" | "system"`) since the `/v1/chat/completions` endpoint mirrors that format.
- `Agent`, `Session`, `Skill`, `Memory`, `Tool`, `Config` types are thin — derived directly from the REST API response shapes in `api-reference.md`.

## Requirements

1. `packages/shared/package.json` — `@nonclaw-ui/shared`, exports: `./types`, `./utils`, `./constants`
2. `packages/shared/tsconfig.json` — extends `@nonclaw-ui/tsconfig/base.json`, noEmit:false
3. Domain types: `ChatMessage`, `Agent`, `Session`, `Skill`, `Memory`, `Tool`, `Config`, `HealthStatus`
4. WS protocol types: `WsReq`, `WsRes`, `WsEvent` (discriminated union by `event` field), all streaming event payloads
5. API types: `ApiError`, HTTP response wrappers
6. `cn()` utility (clsx + tailwind-merge)
7. `formatRelativeTime`, `formatDateTime` (date-fns)
8. Constants: `DEFAULT_DAEMON_URL`, `STORAGE_KEYS`, `WS_METHODS`, `MAX_RECONNECT_ATTEMPTS`

## Architecture

```
packages/shared/
├── package.json
├── tsconfig.json
├── eslint.config.js
└── src/
    ├── types/
    │   ├── index.ts
    │   ├── api.ts          # REST API types (ChatMessage, Agent, Session, etc.)
    │   ├── ws.ts           # WebSocket JSON-RPC types (WsReq, WsRes, WsEvent)
    │   └── store.ts        # Store-specific types (ConnectionStatus)
    ├── utils/
    │   ├── index.ts
    │   ├── cn.ts           # clsx + tailwind-merge
    │   └── format.ts       # date/time formatting
    ├── constants/
    │   ├── index.ts
    │   └── app.ts          # DAEMON_URL, STORAGE_KEYS, WS_METHODS
    └── index.ts
```

## Related Code Files

- `/home/loidinh/ws/sharing/nonclaw/docs/api-reference.md` — REST response shapes
- `/home/loidinh/ws/sharing/nonclaw/docs/websocket-protocol.md` — WS frame schemas + event types
- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/shared-package.md`

## Implementation Steps

### 1. Package config

**`packages/shared/package.json`**
```json
{
  "name": "@nonclaw-ui/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./types": { "types": "./src/types/index.ts", "default": "./src/types/index.ts" },
    "./utils": { "types": "./src/utils/index.ts", "default": "./src/utils/index.ts" },
    "./constants": { "types": "./src/constants/index.ts", "default": "./src/constants/index.ts" },
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" }
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "tailwind-merge": "^3.3.0"
  },
  "devDependencies": {
    "@nonclaw-ui/eslint-config": "workspace:*",
    "@nonclaw-ui/tsconfig": "workspace:*",
    "typescript": "^5.8.3"
  }
}
```

**`packages/shared/tsconfig.json`**
```json
{
  "extends": "@nonclaw-ui/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "noEmit": false
  },
  "include": ["src"]
}
```

**`packages/shared/eslint.config.js`**
```javascript
import { config } from "@nonclaw-ui/eslint-config/base";
export default config;
```

### 2. Domain types — `src/types/api.ts`

```typescript
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
  status: "idle" | "running" | "error";
  uptime_secs?: number;
}

// --- Session ---
export interface Session {
  id: string;
  created_at: string;
  message_count?: number;
}

// --- Memory ---
export interface MemoryEntry {
  key: string;
  value: string;
  snippet?: string;
}

export interface MemorySearchResult {
  key: string;
  value: string;
  snippet: string;
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
```

### 3. WS types — `src/types/ws.ts`

```typescript
// Frame types
export interface WsReq<P = Record<string, unknown>> {
  type: "req";
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

// Streaming event payloads
export interface RunStartedPayload {}
export interface ChunkPayload { content: string }
export interface ToolCallPayload { id: string; name: string; args: Record<string, unknown> }
export interface ToolResultPayload { id: string; name: string; result: string }
export interface RunCompletedPayload { content: string; tool_calls_made: number }
export interface WsErrorPayload { code: string; message: string }

// Discriminated union on event field
export type WsEvent =
  | { type: "event"; event: "run.started"; payload: RunStartedPayload }
  | { type: "event"; event: "chunk"; payload: ChunkPayload }
  | { type: "event"; event: "tool.call"; payload: ToolCallPayload }
  | { type: "event"; event: "tool.result"; payload: ToolResultPayload }
  | { type: "event"; event: "run.completed"; payload: RunCompletedPayload }
  | { type: "event"; event: "error"; payload: WsErrorPayload };

export type WsFrame = WsReq | WsRes | WsEvent;

// WS method response types
export interface ConnectResponse { session_id: string; agent: string; version: string }
export interface AgentStatusResponse { status: string; model: string; uptime_secs: number; memory_count: number }
export interface ChatSendResponse { content: string; tool_calls_made: number }
export interface ChatHistoryResponse { messages: import("./api").ChatMessage[] }
```

### 4. Store types — `src/types/store.ts`

```typescript
export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export interface ConnectionState {
  url: string;
  status: ConnectionStatus;
  version?: string;
  sessionId?: string;
}
```

### 5. Constants — `src/constants/app.ts`

```typescript
export const DEFAULT_DAEMON_URL = "http://localhost:18790";
export const DEFAULT_WS_URL = "ws://localhost:18790/ws";

export const STORAGE_KEYS = {
  DAEMON_URL: "nonclaw-daemon-url",
  THEME: "nonclaw-theme",
} as const;

export const WS_METHODS = {
  CONNECT: "connect",
  CHAT_SEND: "chat.send",
  CHAT_HISTORY: "chat.history",
  CHAT_ABORT: "chat.abort",
  STATUS: "status",
  SESSIONS_LIST: "sessions.list",
  SESSIONS_CREATE: "sessions.create",
  SESSIONS_DELETE: "sessions.delete",
  SKILLS_LIST: "skills.list",
  SKILLS_SEARCH: "skills.search",
  MEMORY_SEARCH: "memory.search",
  CONFIG_GET: "config.get",
} as const;

export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_DELAY_MS = 2000;
```

### 6. Utils

**`src/utils/cn.ts`**
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

**`src/utils/format.ts`**
```typescript
import { format, formatDistanceToNow } from "date-fns";
export function formatDateTime(date: Date | string | number): string {
  return format(new Date(date), "PPp");
}
export function formatRelativeTime(date: Date | string | number): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}
```

### 7. Index barrel files

**`src/types/index.ts`**: `export * from "./api"; export * from "./ws"; export * from "./store";`
**`src/utils/index.ts`**: `export * from "./cn"; export * from "./format";`
**`src/constants/index.ts`**: `export * from "./app";`
**`src/index.ts`**: `export * from "./types"; export * from "./utils"; export * from "./constants";`

## Todo

- [ ] Write package.json, tsconfig.json, eslint.config.js
- [ ] Write src/types/api.ts (all REST domain types)
- [ ] Write src/types/ws.ts (WsReq, WsRes, WsEvent discriminated union)
- [ ] Write src/types/store.ts (ConnectionState, ConnectionStatus)
- [ ] Write src/constants/app.ts (DEFAULT_DAEMON_URL, STORAGE_KEYS, WS_METHODS)
- [ ] Write src/utils/cn.ts, src/utils/format.ts
- [ ] Write all index.ts barrel files
- [ ] `pnpm install` then `pnpm --filter @nonclaw-ui/shared type-check` → zero errors

## Success Criteria

- `pnpm --filter @nonclaw-ui/shared type-check` passes with zero errors
- All domain types match the API shapes in `api-reference.md` and `websocket-protocol.md`
- `WsEvent` is a proper discriminated union (TypeScript narrows correctly by `event` field)
- `cn()` available from `@nonclaw-ui/shared/utils`
- `DEFAULT_DAEMON_URL` available from `@nonclaw-ui/shared/constants`

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| API shape mismatch | Cross-reference every type against api-reference.md during impl |
| WsEvent narrowing | Use `event` as discriminant, not `type` (all events have `type: "event"`) |

## Security Considerations

None — pure type definitions. No credentials or external calls.

## Next Steps

Phase 3: UI Foundation — ServiceFactory with `IChatService` / `IMemoryService` / `IToolService` / `ISkillService` / `IConfigService` interfaces; `WsChatAdapter` + HTTP adapters; Zustand stores (chatStore, memoryStore, connectionStore); atom components.
