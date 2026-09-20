import * as React from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import type { ToolCallPayload, ToolResultPayload } from "@nonclaw-ui/shared/types";
import { resolveToolRenderer, toolName } from "./toolRendererRegistry.js";

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

export function ToolCallCard({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const name = toolName(call);
  const Renderer = resolveToolRenderer(name);
  return (
    <div className="border-border bg-muted/50 mx-4 my-2 min-w-0 max-w-full overflow-hidden rounded-md border font-mono text-xs break-words">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="hover:bg-muted/80 flex w-full min-w-0 items-center gap-2 px-3 py-2 transition-colors"
      >
        <Wrench size={12} className="text-primary shrink-0" />
        <span className="truncate font-medium">{name ?? "unknown tool"}</span>
        <span className="ml-auto shrink-0">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="border-border border-t px-3 py-2 min-w-0 max-w-full overflow-hidden">
          <Renderer call={call} result={result} />
        </div>
      )}
    </div>
  );
}
ToolCallCard.displayName = "ToolCallCard";
