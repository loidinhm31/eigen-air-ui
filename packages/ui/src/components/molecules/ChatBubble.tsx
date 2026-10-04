import * as React from "react";
import { cn } from "@eigen-air-ui/shared/utils";
import type { ChatMessage } from "@eigen-air-ui/shared/types";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { Spinner } from "../atoms/Spinner.js";
import { AssistantMarkdown } from "./AssistantMarkdown.js";
import { ChatBubbleDebugDisclosure } from "./chat-bubble-debug-disclosure.js";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  statusLabel?: string;
}

export function ChatBubble({ message, isStreaming, statusLabel }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasContent = message.content.length > 0;
  const showPromptDebug = useDebugSettingsStore((state) => state.showPromptDebug);
  const showReasoningDebug = useDebugSettingsStore((state) => state.showReasoningDebug);
  const isDebugOptedIn = isAssistant && (showPromptDebug || showReasoningDebug);

  if (message.role === "tool" || (!hasContent && !message.debug && !isStreaming && !message.run_id)) {
    return null;
  }

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
        {isDebugOptedIn && (
          <ChatBubbleDebugDisclosure message={message} isStreaming={isStreaming} />
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
