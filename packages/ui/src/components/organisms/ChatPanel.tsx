import * as React from "react";
import { useRef, useEffect, useState } from "react";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { getChatService } from "../../adapters/factory/ServiceFactory.js";
import { ChatBubble } from "../molecules/ChatBubble.js";
import { ToolCallCard } from "../molecules/ToolCallCard.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Spinner } from "../atoms/Spinner.js";
import type { ToolCallPayload, ToolResultPayload, WsEvent } from "@nonclaw-ui/shared/types";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    messages,
    isStreaming,
    streamingContent,
    streamError,
    addMessage,
    appendChunk,
    finalizeStream,
    setStreamError,
  } = useChatStore();
  const sessionId = useConnectionStore((s) => s.sessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallPayload>>({});
  const [toolResults, setToolResults] = useState<Record<string, ToolResultPayload>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  async function handleSend() {
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput("");
    setToolCalls({});
    setToolResults({});
    addMessage({ role: "user", content: msg });

    try {
      await getChatService().sendMessage(msg, sessionId, (event: WsEvent) => {
        if (event.event === "chunk") {
          appendChunk(event.payload.content);
        } else if (event.event === "run.completed") {
          finalizeStream(event.payload.content);
        } else if (event.event === "tool.call") {
          setToolCalls((t) => ({ ...t, [event.payload.id]: event.payload }));
        } else if (event.event === "tool.result") {
          setToolResults((r) => ({ ...r, [event.payload.id]: event.payload }));
        } else if (event.event === "error") {
          setStreamError(event.payload.message);
        }
      });
    } catch (e) {
      setStreamError(String(e));
    }
  }

  return (
    <div className="flex h-full flex-col">
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
            />
          )}
          {streamError && (
            <div className="mx-4 my-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {streamError}
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
