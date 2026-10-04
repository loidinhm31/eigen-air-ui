import * as React from "react";
import { cn, buildDebugTrace, copyDebugTrace } from "@eigen-air-ui/shared/utils";
import type { ChatDebugData, ChatMessage, HistoricalDebugState } from "@eigen-air-ui/shared/types";
import { Check, Copy, RotateCw } from "lucide-react";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useUserQuestionStore, pendingQuestionSnapshot } from "../../stores/userQuestionStore.js";
import { useChatStore } from "../../stores/chatStore.js";
import { useChatDebugStore } from "../../stores/chat-debug-store.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";

interface ChatBubbleDebugDisclosureProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function getUnavailableReasonMessage(reason: string): string {
  switch (reason) {
    case "expired":
      return "Debug trace has expired and is no longer available.";
    case "unauthorized":
      return "Debug capture is restricted or unauthorized.";
    case "not_found":
      return "Debug trace could not be found for this run.";
    case "disabled":
      return "Debug capture was disabled for this run.";
    case "key_unavailable":
      return "Decryption key is unavailable on the server.";
    case "no_debug_data":
      return "No captured debug data is available for this run.";
    case "invalid":
      return "Debug trace is invalid or corrupted.";
    default:
      return "Debug capture is unavailable for this run.";
  }
}

/**
 * Lazy historical debug disclosure accordion and live streaming debug presenter.
 * Manages native details expansion, single-flight lazy loading interest,
 * stateful rendering (idle/loading/unavailable/error/ready), and guarded clipboard copy.
 */
export function ChatBubbleDebugDisclosure({ message, isStreaming }: ChatBubbleDebugDisclosureProps) {
  const showPromptDebug = useDebugSettingsStore((state) => state.showPromptDebug);
  const showReasoningDebug = useDebugSettingsStore((state) => state.showReasoningDebug);
  const isDebugOptedIn = showPromptDebug || showReasoningDebug;

  const connectionSessionId = useConnectionStore((state) => state.sessionId);
  const messageSessionId = React.useMemo(() => {
    const match = message.id?.match(/^msg-([a-zA-Z0-9_-]+)-\d+-\d+$/);
    return match ? match[1] : undefined;
  }, [message.id]);
  const sessionId = messageSessionId ?? connectionSessionId;
  const consumerId = React.useId();
  const runId = message.run_id;

  const debugKey = isDebugOptedIn && sessionId && runId ? `${sessionId}::${runId}` : undefined;
  const storeState = useChatDebugStore((state) => (debugKey ? state.states[debugKey] : undefined));

  const historicalState: HistoricalDebugState | undefined = React.useMemo(() => {
    if (!isDebugOptedIn || !runId) return undefined;
    if (!storeState) return { status: "idle" };
    if (storeState.status === "ready" && Date.now() >= storeState.expiresAtMs) {
      return { status: "unavailable", runId, reason: "expired" };
    }
    return storeState;
  }, [isDebugOptedIn, runId, storeState]);

  const [isExpanded, setIsExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Cancel registered loader interest on unmount if still expanded
  React.useEffect(() => {
    return () => {
      if (sessionId && runId && isExpanded) {
        useChatDebugStore.getState().cancelInterest(sessionId, runId, consumerId);
      }
    };
  }, [sessionId, runId, consumerId, isExpanded]);

  if (!isDebugOptedIn) {
    return null;
  }

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = event.currentTarget.open;
    setIsExpanded(isOpen);
    // Programmatic streaming auto-open must not trigger historical loader
    if (isStreaming) {
      return;
    }
    if (isOpen) {
      if (sessionId && runId) {
        const current = useChatDebugStore.getState().getState(sessionId, runId);
        if (current.status === "idle") {
          void useChatDebugStore.getState().requestDebug(sessionId, runId, consumerId);
        }
      }
    } else {
      if (sessionId && runId) {
        useChatDebugStore.getState().cancelInterest(sessionId, runId, consumerId);
      }
    }
  };

  const isHistoricalReady = historicalState?.status === "ready" && Date.now() < historicalState.expiresAtMs;
  const canCopy = Boolean(
    !isStreaming &&
      (isHistoricalReady || message.debug)
  );

  const handleCopyDebug = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canCopy) return;

    const connection = useConnectionStore.getState();
    const userQuestion = useUserQuestionStore.getState();
    const chat = useChatStore.getState();

    let resolvedDebug: ChatDebugData | undefined;
    if (isHistoricalReady && historicalState?.status === "ready") {
      resolvedDebug = {
        provider: historicalState.provider,
        model: historicalState.model ?? "Not reported",
        system_prompt: showPromptDebug ? historicalState.systemPrompt : undefined,
        reasoning:
          showReasoningDebug && historicalState.reasoning
            ? {
                requested: true,
                available: historicalState.reasoning.available,
                text: historicalState.reasoning.text || null,
              }
            : undefined,
      };
    } else if (message.debug) {
      resolvedDebug = message.debug;
    }

    const trace = buildDebugTrace({
      message,
      debug: resolvedDebug,
      sessionId: sessionId ?? connection.sessionId,
      daemonUrl: connection.url,
      connectionStatus: connection.status,
      connectionVersion: connection.version,
      questionState: {
        status: userQuestion.status,
        error: userQuestion.error,
        activeQuestionId: pendingQuestionSnapshot(userQuestion)?.question_id,
      },
      streamState: {
        status: chat.streamStatus,
        error: chat.streamError,
      },
    });

    try {
      const success = await copyDebugTrace(trace);
      if (success) {
        setCopied(true);
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <details
      open={isStreaming ? true : undefined}
      onToggle={handleToggle}
      className="mt-3 min-w-0 max-w-full overflow-hidden rounded-md border border-secondary-foreground/15 bg-background/35"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-secondary-foreground/75">
        <span className="truncate">Debug</span>
        <button
          type="button"
          disabled={!canCopy}
          onClick={handleCopyDebug}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal transition-colors",
            canCopy
              ? "text-secondary-foreground/70 hover:bg-secondary-foreground/10 hover:text-secondary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
              : "opacity-40 text-secondary-foreground/40 cursor-not-allowed"
          )}
          title={canCopy ? "Copy all debug and trace information to clipboard" : "Debug trace not available to copy"}
          aria-label="Copy debug information to clipboard"
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy debug"}</span>
        </button>
      </summary>

      {isStreaming ? (
        <div className="space-y-3 border-t border-secondary-foreground/10 p-3 text-xs text-secondary-foreground/85 min-w-0 max-w-full overflow-hidden">
          {message.debug ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 min-w-0">
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Provider
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {message.debug.provider && message.debug.provider !== "default"
                      ? message.debug.provider
                      : "Not reported"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Model
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {message.debug.model && message.debug.model !== "default"
                      ? message.debug.model
                      : "Not reported"}
                  </dd>
                </div>
              </dl>
              {showPromptDebug && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    System Prompt
                  </p>
                  {message.debug.system_prompt ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {message.debug.system_prompt}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      No captured system prompt is available for this run.
                    </p>
                  )}
                </section>
              )}
              {showReasoningDebug && message.debug.reasoning && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Reasoning
                  </p>
                  {message.debug.reasoning.available && message.debug.reasoning.text ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {message.debug.reasoning.text}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      Thinking...
                    </p>
                  )}
                </section>
              )}
            </>
          ) : (
            <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
              Thinking...
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 border-t border-secondary-foreground/10 p-3 text-xs text-secondary-foreground/85 min-w-0 max-w-full overflow-hidden">
          {!runId && !message.debug ? (
            <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
              Debug capture unavailable (no correlated run recorded).
            </p>
          ) : historicalState?.status === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-secondary-foreground/80 py-1">
              <Spinner size="sm" className="shrink-0 text-current" />
              <span>Loading debug trace...</span>
            </div>
          ) : historicalState?.status === "unavailable" ? (
            <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
              {getUnavailableReasonMessage(historicalState.reason)}
            </p>
          ) : historicalState?.status === "error" ? (
            <div className="space-y-2">
              <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-destructive text-xs break-words">
                {historicalState.message || "Failed to load debug trace."}
              </p>
              {historicalState.retryable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (sessionId && runId) {
                      void useChatDebugStore.getState().requestDebug(sessionId, runId, consumerId);
                    }
                  }}
                  className="text-xs h-7 px-2"
                >
                  <RotateCw size={12} className="mr-1" />
                  Retry
                </Button>
              )}
            </div>
          ) : historicalState?.status === "ready" ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 min-w-0">
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Provider
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {historicalState.provider || "Not reported"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Model
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {historicalState.model || "Not reported"}
                  </dd>
                </div>
                {historicalState.isPartial && (
                  <div className="sm:col-span-2 min-w-0">
                    <span className="text-[11px] text-amber-500 font-medium">
                      (Partial debug evidence)
                    </span>
                  </div>
                )}
              </dl>
              {showPromptDebug && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    System Prompt
                  </p>
                  {historicalState.systemPrompt ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {historicalState.systemPrompt}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      No captured system prompt is available for this run. Debug capture may be
                      disabled, inaccessible, or expired.
                    </p>
                  )}
                </section>
              )}
              {showReasoningDebug && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <div className="flex items-center justify-between">
                    <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                      Reasoning
                    </p>
                    {historicalState.reasoning?.truncated && (
                      <span className="text-[10px] text-secondary-foreground/60">
                        (Truncated by server)
                      </span>
                    )}
                  </div>
                  {historicalState.reasoning?.available && historicalState.reasoning.text ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {historicalState.reasoning.text}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      No captured reasoning is available for this run. Debug capture may be
                      disabled, inaccessible, or expired, or the provider may not have emitted
                      reasoning.
                    </p>
                  )}
                </section>
              )}
            </>
          ) : message.debug ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 min-w-0">
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Provider
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {message.debug.provider && message.debug.provider !== "default"
                      ? message.debug.provider
                      : "Not reported"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Model
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">
                    {message.debug.model && message.debug.model !== "default"
                      ? message.debug.model
                      : "Not reported"}
                  </dd>
                </div>
                {message.debug.active_skill && (
                  <div className="sm:col-span-2 min-w-0">
                    <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                      Active Skill
                    </dt>
                    <dd className="mt-1 text-secondary-foreground break-all">
                      <span className="font-mono">{message.debug.active_skill.name}</span>{" "}
                      <span className="text-secondary-foreground/65">
                        score{" "}
                        {Number.isFinite(message.debug.active_skill.score)
                          ? message.debug.active_skill.score.toFixed(2)
                          : String(message.debug.active_skill.score)}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
              {showPromptDebug && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    System Prompt
                  </p>
                  {message.debug.system_prompt ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {message.debug.system_prompt}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      No captured system prompt is available for this run.
                    </p>
                  )}
                </section>
              )}
              {showReasoningDebug && message.debug.reasoning && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Reasoning
                  </p>
                  {message.debug.reasoning.available && message.debug.reasoning.text ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {message.debug.reasoning.text}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      No captured reasoning is available for this run.
                    </p>
                  )}
                </section>
              )}
            </>
          ) : (
            <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
              Expand to load debug trace.
            </p>
          )}
        </div>
      )}
    </details>
  );
}

ChatBubbleDebugDisclosure.displayName = "ChatBubbleDebugDisclosure";
