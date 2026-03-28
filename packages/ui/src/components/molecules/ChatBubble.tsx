import * as React from "react";
import { cn } from "@nonclaw-ui/shared/utils";
import type { ChatMessage } from "@nonclaw-ui/shared/types";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
}

export function ChatBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
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
        {message.content}
        {isStreaming && <span className="ml-1 animate-pulse">▍</span>}
      </div>
    </div>
  );
}
ChatBubble.displayName = "ChatBubble";
