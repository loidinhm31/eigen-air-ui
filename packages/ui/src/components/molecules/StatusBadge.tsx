import * as React from "react";
import { cn } from "@nonclaw-ui/shared/utils";
import { useConnectionStore } from "../../stores/connectionStore.js";

const DOT_COLORS = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  disconnected: "bg-red-500",
} as const;

export function StatusBadge() {
  const status = useConnectionStore((s) => s.status);
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-2 w-2 rounded-full shrink-0", DOT_COLORS[status])} />
      <span className="text-xs text-muted-foreground capitalize">{status}</span>
    </div>
  );
}
StatusBadge.displayName = "StatusBadge";
