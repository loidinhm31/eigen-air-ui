---
title: "nonclaw-ui: Turborepo Tauri v2 + React 19 Desktop UI"
description: "Standalone desktop + web UI for nonclaw AI agent daemon — Tauri v2, React 19, TypeScript, atomic design, REST+WS adapters"
status: in_progress
priority: P2
effort: 14h (6 phases)
branch: main
tags: [tauri, react, turborepo, typescript, ai-agent, desktop-ui]
created: 2026-03-28
---

# nonclaw-ui Implementation Plan

Standalone Turborepo monorepo delivering a desktop (Tauri v2) and web (Vite SPA) UI for the **nonclaw** AI agent daemon. Connects to `localhost:18790` via REST and WebSocket JSON-RPC — no sync, auth, or IndexedDB required.

## Architecture

```
┌──────────────────────────────────────────────┐
│  nonclaw-ui (Turborepo monorepo)             │
│                                              │
│  apps/web  (Vite SPA)  ──┐                   │
│  apps/native (Tauri v2) ──┤                   │
│                           ▼                   │
│  packages/ui → ServiceFactory                 │
│    ├─ WsChatAdapter    ──► WS  /ws            │
│    ├─ HttpMemoryAdapter ──► REST /v1/memory/* │
│    ├─ HttpToolAdapter   ──► REST /v1/tools    │
│    ├─ HttpSkillAdapter  ──► REST /v1/skills   │
│    └─ HttpConfigAdapter ──► REST /v1/config   │
│  packages/shared (types, constants)           │
└──────────────────────┬───────────────────────┘
                       │ localhost:18790
                       ▼
             ┌──────────────────┐
             │  nonclaw daemon  │
             │  REST + WS API   │
             └──────────────────┘
```

## Phase Table

| # | Phase | Status | Effort | Description |
|---|-------|--------|--------|-------------|
| 1 | [Monorepo Scaffold](./phase-01-scaffold.md) | done | 2h | Root configs, tsconfig, eslint packages, git init |
| 2 | [Shared Package](./phase-02-shared.md) | done | 2h | Domain types, WS protocol types, HTTP types, constants |
| 3 | [UI Foundation](./phase-03-ui-foundation.md) | done | 3h | ServiceFactory, HTTP/WS adapters, Zustand stores, atoms |
| 4 | [UI Components](./phase-04-ui-components.md) | pending | 4h | Molecules, organisms, AppShell template, 6 pages |
| 5 | [Web App](./phase-05-web-app.md) | pending | 1.5h | Vite SPA wiring, adapter init, router, dev+build |
| 6 | [Native App (Tauri)](./phase-06-native-app.md) | pending | 1.5h | Tauri v2 shell, src-tauri Rust config, build |

**Total: 14h**

## Validation Summary

**Validated:** 2026-03-28
**Questions asked:** 7

### Confirmed Decisions
- **HTTP auth**: No auth for MVP — assume daemon runs with empty token (default)
- **getStatus() placement**: Move from IConfigService to IChatService (WS-only method, no REST equivalent)
- **WS reconnect**: Full reconnect with re-auth — reject pending promises, re-send `connect` RPC, emit reconnect event
- **Missing services**: Add both ISessionService (WS adapter) and IAgentService (HTTP adapter)
- **Response normalization**: Normalize in adapters — each adapter unwraps to consistent shape (REST returns flat, WS unwraps `.sessions`/`.results` wrapper)
- **Chat transport**: WS-only for MVP — REST SSE loses tool.call/tool.result events and abort capability
- **Transport split**: Sessions via WS (methods already in protocol), Agents via HTTP (CRUD is REST-only)

### Action Items
- [ ] Phase 2: No type changes needed — types already match nonclaw API docs
- [ ] Phase 3: Add `ISessionService` interface + `WsSessionAdapter`
- [ ] Phase 3: Add `IAgentService` interface + `HttpAgentAdapter`
- [ ] Phase 3: Move `getStatus()` from `IConfigService` to `IChatService`
- [ ] Phase 3: Fix WsClient reconnect — reject pending, re-auth, emit event
- [ ] Phase 3: Add `WS_METHODS` entries for sessions if missing
- [ ] Phase 4: Wire SessionsPage to WsSessionAdapter, add AgentsPage or integrate into SettingsPage

### Reference Note
goclaw (Go) is reference architecture only. All types/adapters target nonclaw (Rust) daemon at `localhost:18790` using docs at `/home/loidinh/ws/sharing/nonclaw/docs/`.

## Prerequisites

- [ ] nonclaw daemon running at `localhost:18790` (Phase 7 complete in nonclaw repo)
- [ ] `api-reference.md` and `websocket-protocol.md` finalized (see nonclaw/docs/)
- [ ] Node.js >= 20, pnpm >= 9.1.0, Rust toolchain installed
- [ ] Tauri v2 CLI: `cargo install tauri-cli --version "^2"`
