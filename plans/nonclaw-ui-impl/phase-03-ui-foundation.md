# Phase 3: UI Foundation

> Parent: [plan.md](./plan.md) | Dependencies: Phase 1–2 | Blocks: Phases 4–6
> Docs: turborepo-tauri-react/references/ui-package.md

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P1 |
| Effort | ~3h |
| Implementation | done |
| Review | done |
| Completed | 2026-03-28 |

Create `packages/ui` with ServiceFactory (DI pattern), HTTP + WS adapters for all nonclaw daemon endpoints, Zustand stores, global Tailwind CSS v4 styles, and core atom components (Button, Input, Badge, Card, Spinner, ScrollArea, Tooltip, Avatar).

## Key Insights

- nonclaw-ui is **standalone**: no `IAuthService`, `ISyncService`, `IDbService` — only nonclaw-specific services (`IChatService`, `IMemoryService`, `IToolService`, `ISkillService`, `IConfigService`).
- `WsChatAdapter` manages the WebSocket lifecycle (connect, reconnect, message routing) and exposes `sendMessage(msg, onEvent)` with an async callback per streaming event. The factory holds a single WS connection; adapters share it.
- HTTP adapters use native `fetch` (no axios needed — fewer dependencies, same API). Use `axios` only if SSE streaming for `/v1/chat/completions` REST fallback is needed (prefer WS path).
- `connectionStore` is the single source of truth for daemon URL (read from `localStorage`). On app boot, `HttpConfigAdapter.health()` is called to set `status: "connected" | "disconnected"`.
- Tailwind v4: use `@tailwindcss/vite` plugin (no PostCSS). CSS-first `@theme` directive in `globals.css`.
- Atoms use CVA (`class-variance-authority`) for variants; Radix UI for accessible primitives (Tooltip, ScrollArea).

## Requirements

1. `packages/ui/package.json` — `@nonclaw-ui/ui`, fine-grained exports
2. ServiceFactory with setter/getter pattern for 5 services
3. Interfaces: `IChatService`, `IMemoryService`, `IToolService`, `ISkillService`, `IConfigService`
4. Adapters: `WsChatAdapter`, `HttpMemoryAdapter`, `HttpToolAdapter`, `HttpSkillAdapter`, `HttpConfigAdapter`
5. Zustand stores: `chatStore`, `memoryStore`, `connectionStore`
6. Global styles: `globals.css` (Tailwind v4 + theme tokens + custom variants)
7. Atoms: Button, Input, Badge, Card, Spinner, ScrollArea, Tooltip, Avatar

## Architecture

```
packages/ui/
├── package.json
├── tsconfig.json
├── eslint.config.js
└── src/
    ├── adapters/
    │   ├── factory/
    │   │   ├── ServiceFactory.ts        # setXxx/getXxx singletons
    │   │   └── interfaces/
    │   │       ├── IChatService.ts
    │   │       ├── IMemoryService.ts
    │   │       ├── IToolService.ts
    │   │       ├── ISkillService.ts
    │   │       └── IConfigService.ts
    │   ├── ws/
    │   │   ├── WsClient.ts              # Low-level WS JSON-RPC client
    │   │   └── WsChatAdapter.ts         # IChatService via WebSocket
    │   └── http/
    │       ├── HttpMemoryAdapter.ts
    │       ├── HttpToolAdapter.ts
    │       ├── HttpSkillAdapter.ts
    │       └── HttpConfigAdapter.ts
    ├── stores/
    │   ├── chatStore.ts
    │   ├── memoryStore.ts
    │   └── connectionStore.ts
    ├── components/
    │   └── atoms/
    │       ├── Button.tsx
    │       ├── Input.tsx
    │       ├── Badge.tsx
    │       ├── Card.tsx
    │       ├── Spinner.tsx
    │       ├── ScrollArea.tsx
    │       ├── Tooltip.tsx
    │       ├── Avatar.tsx
    │       └── index.ts
    ├── styles/
    │   └── globals.css                  # Tailwind v4 + @theme
    └── index.ts
```

## Related Code Files

- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/ui-package.md`
- `/home/loidinh/ws/sharing/nonclaw/docs/api-reference.md`
- `/home/loidinh/ws/sharing/nonclaw/docs/websocket-protocol.md`
- `/home/loidinh/ws/sharing/qm-sync/embed-app/fin-catch/packages/ui/src/adapters/` — reference pattern

## Implementation Steps

### 1. Package config

**`packages/ui/package.json`**
```json
{
  "name": "@nonclaw-ui/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./styles": "./src/styles/globals.css",
    "./adapters/factory": "./src/adapters/factory/ServiceFactory.ts",
    "./stores": "./src/stores/index.ts",
    "./components/atoms": "./src/components/atoms/index.ts",
    "./components/molecules": "./src/components/molecules/index.ts",
    "./components/organisms": "./src/components/organisms/index.ts",
    "./components/templates": "./src/components/templates/index.ts",
    "./components/pages": "./src/components/pages/index.ts",
    "./embed": "./src/embed/NonclawApp.tsx",
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "@nonclaw-ui/shared": "workspace:*",
    "@radix-ui/react-tooltip": "^1.1.8",
    "@radix-ui/react-scroll-area": "^1.2.3",
    "@radix-ui/react-avatar": "^1.1.3",
    "class-variance-authority": "^0.7.1",
    "lucide-react": "^0.511.0",
    "react-router-dom": "^7.5.3",
    "zustand": "^5.0.3"
  },
  "devDependencies": {
    "@nonclaw-ui/eslint-config": "workspace:*",
    "@nonclaw-ui/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.1.17",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "tailwindcss": "^4.1.17",
    "typescript": "^5.8.3"
  }
}
```

**`packages/ui/tsconfig.json`**
```json
{
  "extends": "@nonclaw-ui/tsconfig/react-library.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": { "@nonclaw-ui/ui/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

### 2. Service interfaces

**`src/adapters/factory/interfaces/IChatService.ts`**
```typescript
import type { ChatMessage, ChatSendResponse, ChatHistoryResponse, ConnectResponse } from "@nonclaw-ui/shared/types";

export type StreamEventCallback = (event: import("@nonclaw-ui/shared/types").WsEvent) => void;

export interface IChatService {
  connect(token?: string): Promise<ConnectResponse>;
  sendMessage(message: string, sessionId: string | undefined, onEvent: StreamEventCallback): Promise<ChatSendResponse>;
  getHistory(sessionId?: string): Promise<ChatHistoryResponse>;
  abort(): Promise<void>;
  disconnect(): void;
}
```

**`src/adapters/factory/interfaces/IMemoryService.ts`**
```typescript
import type { MemoryEntry, MemorySearchResult } from "@nonclaw-ui/shared/types";

export interface IMemoryService {
  list(): Promise<string[]>;
  store(key: string, value: string): Promise<void>;
  recall(key: string): Promise<MemoryEntry | null>;
  search(query: string): Promise<MemorySearchResult[]>;
  forget(key: string): Promise<void>;
}
```

**`src/adapters/factory/interfaces/IToolService.ts`**
```typescript
import type { Tool, ToolInvokeResult } from "@nonclaw-ui/shared/types";

export interface IToolService {
  list(): Promise<Tool[]>;
  invoke(name: string, args: Record<string, unknown>): Promise<ToolInvokeResult>;
}
```

**`src/adapters/factory/interfaces/ISkillService.ts`**
```typescript
import type { Skill, SkillSearchResult } from "@nonclaw-ui/shared/types";

export interface ISkillService {
  list(): Promise<Skill[]>;
  search(query: string): Promise<SkillSearchResult[]>;
}
```

**`src/adapters/factory/interfaces/IConfigService.ts`**
```typescript
import type { HealthStatus, ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";

export interface IConfigService {
  health(): Promise<HealthStatus>;
  getConfig(): Promise<ServerConfig>;
  getStatus(): Promise<AgentStatusResponse>;
}
```

### 3. ServiceFactory

**`src/adapters/factory/ServiceFactory.ts`**
```typescript
import type { IChatService } from "./interfaces/IChatService";
import type { IMemoryService } from "./interfaces/IMemoryService";
import type { IToolService } from "./interfaces/IToolService";
import type { ISkillService } from "./interfaces/ISkillService";
import type { IConfigService } from "./interfaces/IConfigService";

let chatService: IChatService | null = null;
let memoryService: IMemoryService | null = null;
let toolService: IToolService | null = null;
let skillService: ISkillService | null = null;
let configService: IConfigService | null = null;

export function setChatService(s: IChatService) { chatService = s; }
export function setMemoryService(s: IMemoryService) { memoryService = s; }
export function setToolService(s: IToolService) { toolService = s; }
export function setSkillService(s: ISkillService) { skillService = s; }
export function setConfigService(s: IConfigService) { configService = s; }

export function getChatService(): IChatService {
  if (!chatService) throw new Error("IChatService not initialized");
  return chatService;
}
export function getMemoryService(): IMemoryService {
  if (!memoryService) throw new Error("IMemoryService not initialized");
  return memoryService;
}
export function getToolService(): IToolService {
  if (!toolService) throw new Error("IToolService not initialized");
  return toolService;
}
export function getSkillService(): ISkillService {
  if (!skillService) throw new Error("ISkillService not initialized");
  return skillService;
}
export function getConfigService(): IConfigService {
  if (!configService) throw new Error("IConfigService not initialized");
  return configService;
}
```

### 4. WsClient

**`src/adapters/ws/WsClient.ts`** — low-level JSON-RPC client over WebSocket:
```typescript
import { WsReq, WsRes, WsEvent, WsFrame } from "@nonclaw-ui/shared/types";
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS } from "@nonclaw-ui/shared/constants";

type PendingRequest = { resolve: (res: WsRes) => void; reject: (err: Error) => void };

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers: Array<(event: WsEvent) => void> = [];
  private reconnectAttempts = 0;

  constructor(private readonly url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { this.reconnectAttempts = 0; resolve(); };
      this.ws.onerror = () => reject(new Error("WS connection failed"));
      this.ws.onmessage = (e) => this.handleMessage(e.data as string);
      this.ws.onclose = () => this.handleClose();
    });
  }

  private handleMessage(raw: string) {
    const frame = JSON.parse(raw) as WsFrame;
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (pending) { this.pending.delete(frame.id); pending.resolve(frame); }
    } else if (frame.type === "event") {
      this.eventHandlers.forEach((h) => h(frame));
    }
  }

  private handleClose() {
    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect().catch(() => {}), RECONNECT_DELAY_MS);
    }
  }

  send<P, D>(method: string, params: P): Promise<WsRes<D>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WS not connected")); return;
      }
      const id = crypto.randomUUID();
      const req: WsReq<P> = { type: "req", id, method, params };
      this.pending.set(id, { resolve: resolve as (r: WsRes) => void, reject });
      this.ws.send(JSON.stringify(req));
    });
  }

  onEvent(handler: (event: WsEvent) => void) { this.eventHandlers.push(handler); }
  removeEventHandler(handler: (event: WsEvent) => void) {
    this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
  }
  disconnect() { this.ws?.close(); this.ws = null; }
}
```

### 5. HTTP adapters (pattern — write all 4)

**`src/adapters/http/HttpMemoryAdapter.ts`**
```typescript
import type { IMemoryService } from "../factory/interfaces/IMemoryService";
import type { MemoryEntry, MemorySearchResult } from "@nonclaw-ui/shared/types";

export class HttpMemoryAdapter implements IMemoryService {
  constructor(private readonly baseUrl: string) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) { const err = await res.json(); throw new Error(err.message ?? "Request failed"); }
    return res.json() as Promise<T>;
  }

  list(): Promise<string[]> { return this.fetch("/v1/memory"); }
  store(key: string, value: string): Promise<void> {
    return this.fetch("/v1/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  }
  async recall(key: string): Promise<MemoryEntry | null> {
    try { return await this.fetch<MemoryEntry>(`/v1/memory/${encodeURIComponent(key)}`); }
    catch { return null; }
  }
  search(query: string): Promise<MemorySearchResult[]> {
    return this.fetch(`/v1/memory/search?q=${encodeURIComponent(query)}`);
  }
  forget(key: string): Promise<void> {
    return this.fetch(`/v1/memory/${encodeURIComponent(key)}`, { method: "DELETE" });
  }
}
```

Implement `HttpToolAdapter`, `HttpSkillAdapter`, `HttpConfigAdapter` with the same pattern using the corresponding REST endpoints from `api-reference.md`.

### 6. WsChatAdapter

**`src/adapters/ws/WsChatAdapter.ts`**
```typescript
import { WsClient } from "./WsClient";
import type { IChatService, StreamEventCallback } from "../factory/interfaces/IChatService";
import type { ChatSendResponse, ChatHistoryResponse, ConnectResponse } from "@nonclaw-ui/shared/types";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";

export class WsChatAdapter implements IChatService {
  private client: WsClient;

  constructor(wsUrl: string) { this.client = new WsClient(wsUrl); }

  async connect(token?: string): Promise<ConnectResponse> {
    await this.client.connect();
    const res = await this.client.send<{ token?: string }, ConnectResponse>(
      WS_METHODS.CONNECT, token ? { token } : {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "connect failed");
    return res.data!;
  }

  async sendMessage(message: string, sessionId: string | undefined, onEvent: StreamEventCallback): Promise<ChatSendResponse> {
    this.client.onEvent(onEvent);
    const res = await this.client.send<object, ChatSendResponse>(WS_METHODS.CHAT_SEND, {
      message, stream: true, ...(sessionId ? { session_id: sessionId } : {}),
    });
    this.client.removeEventHandler(onEvent);
    if (!res.ok) throw new Error(res.error?.message ?? "chat.send failed");
    return res.data!;
  }

  async getHistory(sessionId?: string): Promise<ChatHistoryResponse> {
    const res = await this.client.send<object, ChatHistoryResponse>(
      WS_METHODS.CHAT_HISTORY, sessionId ? { session_id: sessionId } : {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "chat.history failed");
    return res.data!;
  }

  async abort(): Promise<void> {
    await this.client.send(WS_METHODS.CHAT_ABORT, {});
  }

  disconnect() { this.client.disconnect(); }
}
```

### 7. Zustand stores

**`src/stores/connectionStore.ts`**
```typescript
import { create } from "zustand";
import type { ConnectionState, ConnectionStatus } from "@nonclaw-ui/shared/types";
import { DEFAULT_DAEMON_URL, STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

interface ConnectionStore extends ConnectionState {
  setUrl(url: string): void;
  setStatus(status: ConnectionStatus, version?: string): void;
  setSessionId(id: string): void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  url: localStorage.getItem(STORAGE_KEYS.DAEMON_URL) ?? DEFAULT_DAEMON_URL,
  status: "disconnected",
  version: undefined,
  sessionId: undefined,
  setUrl: (url) => { localStorage.setItem(STORAGE_KEYS.DAEMON_URL, url); set({ url }); },
  setStatus: (status, version) => set({ status, version }),
  setSessionId: (sessionId) => set({ sessionId }),
}));
```

**`src/stores/chatStore.ts`**
```typescript
import { create } from "zustand";
import type { ChatMessage } from "@nonclaw-ui/shared/types";

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  addMessage(msg: ChatMessage): void;
  appendChunk(chunk: string): void;
  finalizeStream(content: string): void;
  clearMessages(): void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendChunk: (chunk) => set((s) => ({ streamingContent: s.streamingContent + chunk, isStreaming: true })),
  finalizeStream: (content) => set((s) => ({
    messages: [...s.messages, { role: "assistant", content }],
    isStreaming: false,
    streamingContent: "",
  })),
  clearMessages: () => set({ messages: [], streamingContent: "", isStreaming: false }),
}));
```

**`src/stores/memoryStore.ts`**
```typescript
import { create } from "zustand";
import type { MemorySearchResult } from "@nonclaw-ui/shared/types";

interface MemoryStore {
  keys: string[];
  searchResults: MemorySearchResult[];
  setKeys(keys: string[]): void;
  setSearchResults(results: MemorySearchResult[]): void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  keys: [],
  searchResults: [],
  setKeys: (keys) => set({ keys }),
  setSearchResults: (searchResults) => set({ searchResults }),
}));
```

### 8. Atoms (pattern — write all with CVA)

**`src/components/atoms/Button.tsx`**
```typescript
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@nonclaw-ui/shared/utils";
import { forwardRef } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-input bg-background hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-7 px-3 text-xs",
        lg: "h-11 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
);
Button.displayName = "Button";
```

Write remaining atoms (Input, Badge, Card, Spinner, ScrollArea, Tooltip, Avatar) following same CVA + Radix pattern. Refer to fin-catch's atoms for concrete implementations.

### 9. Global styles — `src/styles/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-background: hsl(222 20% 10%);
  --color-foreground: hsl(210 40% 98%);
  --color-primary: hsl(210 100% 56%);
  --color-primary-foreground: hsl(222 84% 5%);
  --color-secondary: hsl(217 33% 18%);
  --color-secondary-foreground: hsl(210 40% 98%);
  --color-muted: hsl(217 33% 18%);
  --color-muted-foreground: hsl(215 20% 65%);
  --color-accent: hsl(217 33% 22%);
  --color-accent-foreground: hsl(210 40% 98%);
  --color-destructive: hsl(0 84% 60%);
  --color-destructive-foreground: hsl(210 40% 98%);
  --color-border: hsl(217 33% 22%);
  --color-input: hsl(217 33% 22%);
  --color-ring: hsl(210 100% 56%);
  --color-card: hsl(222 20% 13%);
  --color-card-foreground: hsl(210 40% 98%);
  --radius: 0.5rem;
}

/* Dark mode by default (nonclaw is a developer/AI tool) */
:root {
  color-scheme: dark;
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: system-ui, -apple-system, sans-serif;
}
```

## Todo

- [x] Write package.json, tsconfig.json, eslint.config.js for packages/ui
- [x] Write 5 service interfaces (IChatService, IMemoryService, IToolService, ISkillService, IConfigService)
- [x] Write ServiceFactory.ts (setters + getters)
- [x] Write WsClient.ts (low-level JSON-RPC)
- [x] Write WsChatAdapter.ts
- [x] Write HttpMemoryAdapter.ts
- [x] Write HttpToolAdapter.ts
- [x] Write HttpSkillAdapter.ts
- [x] Write HttpConfigAdapter.ts
- [x] Write connectionStore.ts, chatStore.ts, memoryStore.ts
- [x] Write globals.css (Tailwind v4 @theme)
- [x] Write atoms: Button, Input, Badge, Card, Spinner, ScrollArea, Tooltip, Avatar
- [x] Write barrel index files
- [x] `pnpm --filter @nonclaw-ui/ui type-check` → zero errors

## Success Criteria

- `pnpm --filter @nonclaw-ui/ui type-check` passes
- `WsChatAdapter` connects to a running nonclaw daemon (manual test)
- `HttpMemoryAdapter.list()` returns memory keys from daemon
- `useConnectionStore()` reads/writes daemon URL from localStorage
- Button, Input, Badge atoms render correctly in Storybook or app

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| WS reconnect race conditions | Single WsClient instance per adapter; pending map keyed by request id |
| HTTP error format mismatch | `{error, message}` — wrap all HTTP errors consistently |
| Radix peer dependency version | Pin `@radix-ui/*` to `^1.x` as per spec; check fin-catch's working versions |
| CVA tree-shaking with Tailwind v4 | CVA works with string classes; Tailwind v4 scans source files by default |

## Security Considerations

- All HTTP calls go to `localhost:18790` — no cross-origin risk in dev. For production Tauri, use capability permissions to restrict network access.
- Daemon URL from localStorage is validated to be a valid URL before use.
- WS token is passed only if `[server] token` is configured — the connect step handles auth.

## Next Steps

Phase 4: UI Components — molecules (ChatBubble, ToolCallCard, MemoryItem, SkillCard, StatusBadge), organisms (ChatPanel, MemoryBrowser, ToolsPanel, SkillBrowser, ConnectionStatus), AppShell template, and all 6 pages.
