import * as React from "react";
import { cn } from "@nonclaw-ui/shared/utils";
import type { ChatMessage } from "@nonclaw-ui/shared/types";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
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
  const debug = message.role === "assistant" ? message.debug : undefined;

  return (
    <div className={cn("flex gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2 text-sm break-words",
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
            className="mt-3 overflow-hidden rounded-md border border-secondary-foreground/15 bg-background/35"
          >
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-secondary-foreground/75">
              Debug
            </summary>
            <div className="space-y-3 border-t border-secondary-foreground/10 px-3 py-3 text-xs text-secondary-foreground/85">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Provider
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground">{debug.provider}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Model
                  </dt>
                  <dd className="mt-1 font-mono text-secondary-foreground">{debug.model}</dd>
                </div>
                {debug.active_skill && (
                  <div className="sm:col-span-2">
                    <dt className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                      Active Skill
                    </dt>
                    <dd className="mt-1 text-secondary-foreground">
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
                <section className="space-y-1.5">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    System Prompt
                  </p>
                  <pre className="overflow-x-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap">
                    {debug.system_prompt}
                  </pre>
                </section>
              )}

              {showReasoningDebug && debug.reasoning && (
                <section className="space-y-1.5">
                  <p className="uppercase tracking-[0.12em] text-secondary-foreground/60">
                    Reasoning
                  </p>
                  {debug.reasoning.available && debug.reasoning.text ? (
                    <pre className="overflow-x-auto rounded-md border border-secondary-foreground/10 bg-background/55 p-3 text-[11px] leading-relaxed text-secondary-foreground whitespace-pre-wrap">
                      {debug.reasoning.text}
                    </pre>
                  ) : (
                    <p className="rounded-md border border-dashed border-secondary-foreground/15 bg-background/45 px-3 py-2 text-secondary-foreground/75">
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
