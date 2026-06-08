import * as React from "react";
import { cn } from "@nonclaw-ui/shared/utils";
import type { ChatMessage } from "@nonclaw-ui/shared/types";
import { Spinner } from "../atoms/Spinner.js";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  statusLabel?: string;
}

export function ChatBubble({ message, isStreaming, statusLabel }: Props) {
  const isUser = message.role === "user";
  const hasContent = message.content.trim().length > 0;

  return (
    <div className={cn("flex gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "rounded-lg px-4 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        )}
      >
        {hasContent && (
          <>
            {message.content}
            {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
          </>
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
