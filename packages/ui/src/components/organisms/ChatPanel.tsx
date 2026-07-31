import * as React from "react";
import { useRef, useEffect, useState } from "react";
import {
  getChatService,
  getSessionService,
  getSkillService,
} from "../../adapters/factory/ServiceFactory.js";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useMemoryStore } from "../../stores/memoryStore.js";
import { ChatBubble } from "../molecules/ChatBubble.js";
import { CommandPalette } from "../molecules/CommandPalette.js";
import type { PaletteSelection } from "../molecules/commandPaletteModel.js";
import { ToolCallCard } from "../molecules/ToolCallCard.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Spinner } from "../atoms/Spinner.js";
import type {
  Skill,
  ToolCallPayload,
  ToolResultPayload,
  WsEvent,
} from "@nonclaw-ui/shared/types";

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
  const composerRef = useRef<HTMLInputElement>(null);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallPayload>>({});
  const [toolResults, setToolResults] = useState<Record<string, ToolResultPayload>>({});
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillLoadError, setSkillLoadError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bumpMemoryRevision = useMemoryStore((state) => state.bumpRevision);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    let cancelled = false;

    if (connectionStatus !== "connected") {
      setSkills([]);
      setSkillsLoading(true);
      setSkillLoadError(null);
      return;
    }

    setSkillsLoading(true);
    setSkillLoadError(null);
    Promise.resolve()
      .then(() => getSkillService().list())
      .then((availableSkills) => {
        if (cancelled) return;
        setSkills(availableSkills);
        setSkillsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setSkillsLoading(false);
        setSkillLoadError("Installed skills unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [connectionStatus]);

  useEffect(() => {
    setSelectedSkill(null);
    setPaletteOpen(false);
  }, [connectionStatus, sessionId]);

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
    const selectedSkillId = selectedSkill?.id;
    setInput("");
    setSelectedSkill(null);
    setPaletteOpen(false);
    setToolCalls({});
    setToolResults({});
    setMemoryNotice(null);
    addMessage({ role: "user", content: msg });
    beginStream("Submitting message...");

    try {
      const result = await getChatService().sendMessage(
        msg,
        sessionId,
        (event: WsEvent) => {
          if (event.event === "run.started") {
            beginStream(PROVIDER_WAIT_STATUS);
          } else if (event.event === "chunk") {
            appendChunk(event.payload.content);
          } else if (event.event === "run.delta") {
            appendChunk(event.payload.delta);
          } else if (event.event === "run.completed" || event.event === "run.finished") {
            finalizeStream(event.payload.content);
          } else if (event.event === "tool.call" || event.event === "tool.started") {
            setToolCalls((calls) => ({ ...calls, [event.payload.id]: event.payload }));
            setStreamStatus(`Running ${event.payload.name}...`);
          } else if (event.event === "tool.result" || event.event === "tool.finished") {
            setToolResults((results) => ({ ...results, [event.payload.id]: event.payload }));
            setStreamStatus(PROVIDER_WAIT_STATUS);
          } else if (event.event === "error") {
            setStreamError(event.payload.message);
          }
        },
        selectedSkillId !== undefined ? { selectedSkillId } : undefined
      );
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

  function handlePaletteSelect(outcome: PaletteSelection) {
    if (outcome.kind === "command") {
      setSelectedSkill(null);
      setInput(outcome.command);
      return;
    }

    setSelectedSkill(outcome.skill);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "/" &&
      input.length === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      void handleSend();
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
      setSelectedSkill(null);
      setPaletteOpen(false);
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

      <div className="border-t border-border p-3">
        {selectedSkill && (
          <div className="mb-2 flex items-center gap-2" role="status">
            <span className="rounded-full border border-border bg-accent px-2.5 py-1 text-xs">
              Skill: {selectedSkill.name}
            </span>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove selected skill ${selectedSkill.name}`}
              onClick={() => {
                setSelectedSkill(null);
                composerRef.current?.focus();
              }}
            >
              Remove
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            skills={skills}
            loading={skillsLoading}
            error={skillLoadError}
            disabled={isStreaming}
            onSelect={handlePaletteSelect}
            onRequestComposerFocus={() => composerRef.current?.focus()}
          />
          <Input
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
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
    </div>
  );
}
ChatPanel.displayName = "ChatPanel";
