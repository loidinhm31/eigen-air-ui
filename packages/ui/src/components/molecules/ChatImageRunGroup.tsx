import { cn } from "@eigen-air-ui/shared/utils";
import type { ImageRunGroup } from "../../stores/image-run-groups.js";
import { ChatImageAttachment } from "./ChatImageAttachment.js";

export interface ChatImageRunGroupProps {
  group: ImageRunGroup;
  /** Visible heading for groups not bound to an assistant message (no message is fabricated). */
  label?: string;
  /**
   * 1-based position of this run among the visible groups. Makes the accessible name of a group
   * without `label` unique ("Generated images, run N"); callers with several groups should pass it.
   */
  ordinal?: number;
  /** Overrides the default chat-column padding (`px-4 pb-2`). */
  className?: string;
}

/** Images of one run, in server order, as an accessible grid of attachments. */
export function ChatImageRunGroup({ group, label, ordinal, className }: ChatImageRunGroupProps) {
  const defaultName =
    ordinal === undefined ? "Generated images" : `Generated images, run ${ordinal}`;
  return (
    <div
      role="group"
      aria-label={label ?? defaultName}
      className={cn("min-w-0 px-4 pb-2", className)}
    >
      {label !== undefined && (
        <p className="text-muted-foreground mb-1 text-xs" aria-hidden="true">
          {label}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {group.items.map((artifact, index) => (
          <ChatImageAttachment
            key={artifact.artifact_id}
            artifact={artifact}
            index={index}
            count={group.items.length}
          />
        ))}
      </div>
    </div>
  );
}

ChatImageRunGroup.displayName = "ChatImageRunGroup";
