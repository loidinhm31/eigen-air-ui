import * as React from "react";
import { useRef, useEffect, useState } from "react";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useMemoryStore } from "../../stores/memoryStore.js";
import { getChatService, getSessionService } from "../../adapters/factory/ServiceFactory.js";
import { ChatBubble } from "../molecules/ChatBubble.js";
import { ToolCallCard } from "../molecules/ToolCallCard.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Spinner } from "../atoms/Spinner.js";
import type { ToolCallPayload, ToolResultPayload, WsEvent } from "@nonclaw-ui/shared/types";

const PROVIDER_WAIT_STATUS = "Waiting for agent response...";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    messages,
    isStreaming,
    streamingContent,
    streamStatus,
    streamError,
    addMessage,
    replaceMessages,
    beginStream,
    appendChunk,
    setStreamStatus,
    finalizeStream,
    setStreamError,
    clearMessages,
  } = useChatStore();
  const sessionId = useConnectionStore((state) => state.sessionId);
  const connectionStatus = useConnectionStore((state) => state.status);
  const setSessionId = useConnectionStore((state) => state.setSessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallPayload>>({});
  const [toolResults, setToolResults] = useState<Record<string, ToolResultPayload>>({});
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const bumpMemoryRevision = useMemoryStore((state) => state.bumpRevision);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setToolCalls({});
      setToolResults({});
      setMemoryNotice(null);

      if (!sessionId) {
        clearMessages();
        return;
      }

      if (connectionStatus !== "connected") {
        return;
      }

      clearMessages();
      for (let attempt = 0; attempt < 10 && !cancelled; attempt++) {
        try {
          const history = await getChatService().getHistory(sessionId);
          if (!cancelled) {
            replaceMessages(history.messages);
          }
          return;
        } catch (error) {
          if (String(error).includes("WS not connected") && attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          if (!cancelled) {
            replaceMessages([]);
            setStreamError(String(error));
          }
          return;
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [clearMessages, connectionStatus, replaceMessages, sessionId, setStreamError]);

  async function handleSend() {
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput("");
    setToolCalls({});
    setToolResults({});
    setMemoryNotice(null);
    addMessage({ role: "user", content: msg });
    beginStream("Submitting message...");

    try {
      const result = await getChatService().sendMessage(msg, sessionId, (event: WsEvent) => {
        if (event.event === "run.started") {
          beginStream(PROVIDER_WAIT_STATUS);
        } else if (event.event === "chunk") {
          appendChunk(event.payload.content);
        } else if (event.event === "run.delta") {
          appendChunk(event.payload.delta);
        } else if (event.event === "run.completed" || event.event === "run.finished") {
          finalizeStream(event.payload.content);
        } else if (event.event === "tool.call" || event.event === "tool.started") {
          setToolCalls((t) => ({ ...t, [event.payload.id]: event.payload }));
          setStreamStatus(`Running ${event.payload.name}...`);
        } else if (event.event === "tool.result" || event.event === "tool.finished") {
          setToolResults((r) => ({ ...r, [event.payload.id]: event.payload }));
          setStreamStatus(PROVIDER_WAIT_STATUS);
        } else if (event.event === "error") {
          setStreamError(event.payload.message);
        }
      });
      bumpMemoryRevision();
      if (result.memory_updated) {
        setMemoryNotice(
          result.episode_id
            ? `Memory updated: episode saved, ${result.fact_count ?? 0} derived facts`
            : "Working memory updated"
        );
      } else if (result.memory_reason === "sensitive_content") {
        setMemoryNotice("Memory not saved because the transcript may contain sensitive content");
      }
    } catch (e) {
      setStreamError(String(e));
    }
  }

  async function handleNewChat() {
    if (isStreaming || isStartingSession) return;
    setIsStartingSession(true);
    try {
      const session = await getSessionService().createSession();
      setSessionId(session.id);
      clearMessages();
      setToolCalls({});
      setToolResults({});
      setMemoryNotice(null);
      setInput("");
    } catch (e) {
      setStreamError(String(e));
    } finally {
      setIsStartingSession(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Chat</p>
          {sessionId && (
            <p className="truncate font-mono text-xs text-muted-foreground" title={sessionId}>
              Session: {sessionId}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleNewChat()}
          disabled={isStreaming || isStartingSession}
          isLoading={isStartingSession}
        >
          New chat
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {messages.map((msg, i) => (
            <ChatBubble key={i} message={msg} />
          ))}
          {Object.values(toolCalls).map((tc) => (
            <ToolCallCard key={tc.id} call={tc} result={toolResults[tc.id]} />
          ))}
          {isStreaming && (
            <ChatBubble
              message={{ role: "assistant", content: streamingContent }}
              isStreaming
              statusLabel={streamStatus ?? undefined}
            />
          )}
          {streamError && (
            <div className="mx-4 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {streamError}
            </div>
          )}
          {memoryNotice && (
            <div className="mx-4 my-2 rounded-md border border-border bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
              {memoryNotice}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void handleSend()}
          placeholder="Message nonclaw..."
          disabled={isStreaming}
          className="flex-1"
        />
        {isStreaming ? (
          <Button
            variant="outline"
            size="icon"
            onClick={() => getChatService().abort()}
            title="Abort"
          >
            <Spinner size="sm" />
          </Button>
        ) : (
          <Button onClick={() => void handleSend()} disabled={!input.trim()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
ChatPanel.displayName = "ChatPanel";
