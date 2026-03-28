# Phase 4: UI Components

> Parent: [plan.md](./plan.md) | Dependencies: Phase 3 | Blocks: Phases 5–6

## Overview

| Field | Value |
|-------|-------|
| Date | 2026-03-28 |
| Priority | P1 |
| Effort | ~4h |
| Implementation | done |
| Review | done |

Build all UI components in `packages/ui/src/components/`: molecules, organisms, AppShell template, and 6 pages (Chat, Memory, Tools, Skills, Settings, Sessions). Uses stores + adapters from Phase 3.

## Key Insights

- `ChatPanel` is the most complex component — it drives streaming via `getChatService().sendMessage()`, dispatches `appendChunk` on each `chunk` event, and calls `finalizeStream` on `run.completed`. It renders tool call cards inline in the message stream.
- All pages are **lean** — they mount organisms and pass callbacks. Business logic lives in hooks or stores, not page components.
- `AppShell` uses `react-router-dom` `<Outlet />` for nested routes. Sidebar shows icons + labels for 6 nav items.
- `ToolCallCard` is collapsible (expand to show args + result). Default collapsed when tool result arrives.
- `StatusBadge` in the sidebar header reflects `connectionStore.status` with color (green/yellow/red).
- No markdown renderer in v1 — render `pre`-wrapped text for assistant messages. Add `react-markdown` in a future iteration if needed.

## Requirements

1. Molecules: ChatBubble, ToolCallCard, MemoryItem, SkillCard, StatusBadge (5 components)
2. Organisms: ChatPanel, MemoryBrowser, ToolsPanel, SkillBrowser, ConnectionStatus (5 components)
3. Templates: AppShell (sidebar + Outlet), with session creation UI
4. Pages: ChatPage, MemoryPage, ToolsPage, SkillsPage, SettingsPage, SessionsPage (6 pages)
5. Embed entry point: `NonclawApp.tsx` (wraps Router + providers + AppShell)

## Architecture

```
packages/ui/src/components/
├── atoms/                         # Phase 3
├── molecules/
│   ├── ChatBubble.tsx             # user/assistant message bubble
│   ├── ToolCallCard.tsx           # collapsible tool call + result
│   ├── MemoryItem.tsx             # key-value row + delete button
│   ├── SkillCard.tsx              # skill name + description + BM25 score
│   ├── StatusBadge.tsx            # connected/connecting/disconnected indicator
│   └── index.ts
├── organisms/
│   ├── ChatPanel.tsx              # full chat UI (message list + input + streaming)
│   ├── MemoryBrowser.tsx          # search input + memory list + pagination
│   ├── ToolsPanel.tsx             # tool list + invoke modal
│   ├── SkillBrowser.tsx           # search + skill results
│   ├── ConnectionStatus.tsx       # daemon URL input + connect button + status
│   └── index.ts
├── templates/
│   ├── AppShell.tsx               # sidebar + main Outlet
│   └── index.ts
├── pages/
│   ├── ChatPage.tsx
│   ├── MemoryPage.tsx
│   ├── ToolsPage.tsx
│   ├── SkillsPage.tsx
│   ├── SettingsPage.tsx
│   ├── SessionsPage.tsx
│   └── index.ts
└── embed/
    └── NonclawApp.tsx             # entry point: MemoryRouter + providers
```

## Related Code Files

- `packages/ui/src/stores/` (Phase 3) — chatStore, memoryStore, connectionStore
- `packages/ui/src/adapters/factory/ServiceFactory.ts` (Phase 3) — getChatService, etc.
- `/home/loidinh/ws/sharing/qm-sync/.claude/skills/turborepo-tauri-react/references/settings-page-pattern.md`

## Implementation Steps

### Molecules

**`ChatBubble.tsx`**
```typescript
import { cn } from "@nonclaw-ui/shared/utils";
import type { ChatMessage } from "@nonclaw-ui/shared/types";

interface Props { message: ChatMessage; isStreaming?: boolean }

export function ChatBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "rounded-lg px-4 py-2 text-sm max-w-[80%] whitespace-pre-wrap",
        isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
      )}>
        {message.content}
        {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
      </div>
    </div>
  );
}
```

**`ToolCallCard.tsx`**
```typescript
import { useState } from "react";
import type { ToolCallPayload, ToolResultPayload } from "@nonclaw-ui/shared/types";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@nonclaw-ui/shared/utils";

interface Props { call: ToolCallPayload; result?: ToolResultPayload }

export function ToolCallCard({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-4 my-2 rounded-md border border-border bg-muted/50 text-xs">
      <button onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/80">
        <Wrench size={12} className="text-primary" />
        <span className="font-mono font-medium">{call.name}</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <span className="text-muted-foreground">args: </span>
            <pre className="inline">{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          {result && (
            <div>
              <span className="text-muted-foreground">result: </span>
              <pre className="inline whitespace-pre-wrap">{result.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**`StatusBadge.tsx`**
```typescript
import { useConnectionStore } from "../../stores/connectionStore";
import { cn } from "@nonclaw-ui/shared/utils";

export function StatusBadge() {
  const status = useConnectionStore((s) => s.status);
  const colors = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    disconnected: "bg-red-500",
  };
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-2 w-2 rounded-full", colors[status])} />
      <span className="text-xs text-muted-foreground capitalize">{status}</span>
    </div>
  );
}
```

Write `MemoryItem.tsx` and `SkillCard.tsx` similarly.

### Organisms

**`ChatPanel.tsx`** (key organism — implement fully):
```typescript
import { useRef, useEffect, useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { getChatService } from "../../adapters/factory/ServiceFactory";
import { ChatBubble } from "../molecules/ChatBubble";
import { ToolCallCard } from "../molecules/ToolCallCard";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { ScrollArea } from "../atoms/ScrollArea";
import type { ToolCallPayload, ToolResultPayload, WsEvent } from "@nonclaw-ui/shared/types";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const { messages, isStreaming, streamingContent, addMessage, appendChunk, finalizeStream } = useChatStore();
  const sessionId = useConnectionStore((s) => s.sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Track tool calls/results for inline rendering
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallPayload>>({});
  const [toolResults, setToolResults] = useState<Record<string, ToolResultPayload>>({});

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamingContent]);

  async function handleSend() {
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput("");
    addMessage({ role: "user", content: msg });
    try {
      await getChatService().sendMessage(msg, sessionId, (event: WsEvent) => {
        if (event.event === "chunk") appendChunk(event.payload.content);
        else if (event.event === "run.completed") finalizeStream(event.payload.content);
        else if (event.event === "tool.call") setToolCalls((t) => ({ ...t, [event.payload.id]: event.payload }));
        else if (event.event === "tool.result") setToolResults((r) => ({ ...r, [event.payload.id]: event.payload }));
      });
    } catch (e) { finalizeStream(`Error: ${String(e)}`); }
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-4">
        {messages.map((msg, i) => <ChatBubble key={i} message={msg} />)}
        {/* Render tool calls between user and assistant messages */}
        {Object.values(toolCalls).map((tc) => (
          <ToolCallCard key={tc.id} call={tc} result={toolResults[tc.id]} />
        ))}
        {isStreaming && <ChatBubble message={{ role: "assistant", content: streamingContent }} isStreaming />}
        <div ref={bottomRef} />
      </ScrollArea>
      <div className="flex gap-2 border-t border-border p-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Message nonclaw..."
          disabled={isStreaming}
          className="flex-1"
        />
        <Button onClick={handleSend} disabled={isStreaming || !input.trim()}>Send</Button>
      </div>
    </div>
  );
}
```

Implement `MemoryBrowser`, `ToolsPanel`, `SkillBrowser`, `ConnectionStatus` following same pattern (load data on mount, render list + actions).

### AppShell Template

**`AppShell.tsx`**
```typescript
import { Outlet, NavLink } from "react-router-dom";
import { MessageSquare, Brain, Wrench, BookOpen, Settings, History } from "lucide-react";
import { StatusBadge } from "../molecules/StatusBadge";
import { cn } from "@nonclaw-ui/shared/utils";

const NAV_ITEMS = [
  { to: "/", icon: MessageSquare, label: "Chat" },
  { to: "/memory", icon: Brain, label: "Memory" },
  { to: "/tools", icon: Wrench, label: "Tools" },
  { to: "/skills", icon: BookOpen, label: "Skills" },
  { to: "/sessions", icon: History, label: "Sessions" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function AppShell() {
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <nav className="flex w-52 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm">nonclaw</span>
          <StatusBadge />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) =>
              cn("flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                 isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")
            }>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
```

### Pages (lean wrappers)

Each page just mounts the relevant organism. Example:

**`ChatPage.tsx`**: `export function ChatPage() { return <ChatPanel />; }`
**`MemoryPage.tsx`**: `export function MemoryPage() { return <div className="h-full p-4"><MemoryBrowser /></div>; }`
**`SettingsPage.tsx`**: renders `ConnectionStatus` + theme selector + config display.

### Embed entry

**`embed/NonclawApp.tsx`**
```typescript
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "../components/templates/AppShell";
import { ChatPage } from "../components/pages/ChatPage";
import { MemoryPage } from "../components/pages/MemoryPage";
import { ToolsPage } from "../components/pages/ToolsPage";
import { SkillsPage } from "../components/pages/SkillsPage";
import { SettingsPage } from "../components/pages/SettingsPage";
import { SessionsPage } from "../components/pages/SessionsPage";

interface Props { useRouter?: boolean }

export function NonclawApp({ useRouter = true }: Props) {
  const inner = (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<ChatPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
  return useRouter ? <MemoryRouter>{inner}</MemoryRouter> : inner;
}
```

## Todo

- [x] ChatBubble.tsx (user/assistant variants, streaming cursor)
- [x] ToolCallCard.tsx (collapsible, args + result)
- [x] MemoryItem.tsx (key-value + delete)
- [x] SkillCard.tsx (name + description + score badge)
- [x] StatusBadge.tsx (green/yellow/red dot + label)
- [x] ChatPanel.tsx (streaming, tool calls inline, scroll-to-bottom)
- [x] MemoryBrowser.tsx (search + list + delete + error handling)
- [x] ToolsPanel.tsx (list + invoke with JSON input)
- [x] SkillBrowser.tsx (BM25 search input + results)
- [x] ConnectionStatus.tsx (URL input + connect + status)
- [x] AppShell.tsx (sidebar nav + Outlet)
- [x] All 6 page components
- [x] NonclawApp.tsx embed entry
- [x] Barrel index.ts for each level
- [x] `pnpm --filter @nonclaw-ui/ui type-check` → zero errors

## Success Criteria

- AppShell renders with all 6 nav items; active route highlighted
- ChatPanel sends message → streaming chunks appear → run.completed finalizes message
- ToolCallCard renders inside chat stream when tool is used
- MemoryBrowser lists memories and search works
- ConnectionStatus shows live daemon status from connectionStore
- SettingsPage allows changing daemon URL (persisted to localStorage)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Tool calls rendered out of order | Buffer tool calls by `id`; only render ToolCallCard when full pair (call + result) received, or render in-progress state |
| Large message lists performance | React virtualization if >500 messages (not needed for v1) |
| ChatPanel re-renders on every chunk | Use Zustand subscriptions; `appendChunk` only updates `streamingContent` string |

## Security Considerations

- Tool invocation from ToolsPanel is subject to nonclaw daemon security policy — no client-side bypass.
- User-provided daemon URL is sanitized to valid URL before storing.

## Next Steps

Phase 5: Web App — `apps/web` Vite SPA wiring: adapter initialization (init.ts), BrowserRouter, import of `NonclawApp`, health check on mount.
