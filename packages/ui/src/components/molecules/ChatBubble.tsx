import * as React from "react";
import { cn, buildDebugTrace, copyDebugTrace } from "@nonclaw-ui/shared/utils";
import type { ChatMessage } from "@nonclaw-ui/shared/types";
import { Check, Copy } from "lucide-react";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useUserQuestionStore, pendingQuestionSnapshot } from "../../stores/userQuestionStore.js";
import { useChatStore } from "../../stores/chatStore.js";
import { Spinner } from "../atoms/Spinner.js";
import { AssistantMarkdown } from "./AssistantMarkdown.js";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  statusLabel?: string;
}

function formatSkillScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : String(score);
}

export function ChatBubble({ message, isStreaming, statusLabel }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasContent = message.content.length > 0;
  const showPromptDebug = useDebugSettingsStore((state) => state.showPromptDebug);
  const showReasoningDebug = useDebugSettingsStore((state) => state.showReasoningDebug);
  const debug =
    message.role === "assistant"
      ? message.debug ??
        (showPromptDebug || showReasoningDebug
          ? {
              provider: "default",
              model: "default",
              reasoning: showReasoningDebug
                ? {
                    requested: true,
                    available: false,
                    text: null,
                  }
                : undefined,
            }
          : undefined)
      : undefined;
  if (message.role === "tool" || (!hasContent && !message.debug && !isStreaming)) {
    return null;
  }
  const [copied, setCopied] = React.useState(false);
  const copyTimeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    return () => {
      clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const handleCopyDebug = async () => {
    const connection = useConnectionStore.getState();
    const userQuestion = useUserQuestionStore.getState();
    const chat = useChatStore.getState();
    const trace = buildDebugTrace({
      message,
      debug,
      sessionId: connection.sessionId,
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
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopied(true);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };
  return (
    <div className={cn("flex w-full min-w-0 gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "min-w-0 max-w-[90%] sm:max-w-[85%] md:max-w-[80%] rounded-lg px-4 py-2 text-sm break-words",
          isUser
            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
            : cn(
                "bg-secondary text-secondary-foreground",
                !isAssistant && "whitespace-pre-wrap"
              )
        )}
      >
        {hasContent && (
          <>
            {isAssistant ? <AssistantMarkdown content={message.content} /> : message.content}
            {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
          </>
        )}
        {debug && (
          <details
            open={isStreaming ? true : undefined}
            className="mt-3 min-w-0 max-w-full overflow-hidden rounded-md border border-secondary-foreground/15 bg-background/35"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-secondary-foreground/75">
              <span className="truncate">Debug</span>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleCopyDebug();
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-secondary-foreground/70 transition-colors hover:bg-secondary-foreground/10 hover:text-secondary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                title="Copy all debug and trace information to clipboard"
                aria-label="Copy debug information to clipboard"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                <span>{copied ? "Copied" : "Copy debug"}</span>
              </button>
            </summary>
            <div className="space-y-3 border-t border-secondary-foreground/10 p-3 text-xs text-secondary-foreground/85 min-w-0 max-w-full overflow-hidden">
              <dl className="grid gap-3 sm:grid-cols-2 min-w-0">
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Provider
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">{debug.provider}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Model
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground break-all">{debug.model}</dd>
                </div>
                {debug.active_skill && (
                  <div className="sm:col-span-2 min-w-0">
                    <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                      Active Skill
                    </dt>
                    <dd className="mt-1 text-secondary-foreground break-all">
                      <span className="font-mono">{debug.active_skill.name}</span>
                      {" "}
                      <span className="text-secondary-foreground/65">
                        score {formatSkillScore(debug.active_skill.score)}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {showPromptDebug && debug.system_prompt && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    System Prompt
                  </p>
                  <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                    {debug.system_prompt}
                  </pre>
                </section>
              )}

              {showReasoningDebug && debug.reasoning && (
                <section className="space-y-1.5 min-w-0 max-w-full">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Reasoning
                  </p>
                  {debug.reasoning.available && debug.reasoning.text ? (
                    <pre className="mt-1 max-h-60 max-w-full overflow-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap break-words break-all">
                      {debug.reasoning.text}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75 text-xs break-words">
                      Reasoning was requested, but this provider did not expose it for the run.
                     </p>
                  )}
                </section>
              )}
            </div>
          </details>
        )}
        {isStreaming && (
          <div
            data-testid="chat-stream-status"
            className={cn(
              "flex items-center gap-2 text-xs",
              hasContent ? "mt-2 text-secondary-foreground/70" : "text-secondary-foreground/80"
            )}
          >
            <Spinner size="sm" className="shrink-0 text-current" />
            <span>{statusLabel ?? "Working on it..."}</span>
          </div>
        )}
      </div>
    </div>
  );
}

ChatBubble.displayName = "ChatBubble";
