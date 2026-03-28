import * as React from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@nonclaw-ui/shared/utils";
import type { ToolCallPayload, ToolResultPayload } from "@nonclaw-ui/shared/types";

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

export function ToolCallCard({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-4 my-2 rounded-md border border-border bg-muted/50 text-xs font-mono">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/80 transition-colors"
      >
        <Wrench size={12} className="text-primary shrink-0" />
        <span className="font-medium truncate">{call.name}</span>
        <span className="ml-auto shrink-0">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <span className="text-muted-foreground">args: </span>
            <pre className="mt-1 overflow-x-auto text-foreground">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          {result && (
            <div>
              <span className="text-muted-foreground">result: </span>
              <pre className="mt-1 whitespace-pre-wrap text-foreground">{result.result}</pre>
            </div>
          )}
          {!result && (
            <p className="text-muted-foreground italic">running...</p>
          )}
        </div>
      )}
    </div>
  );
}
ToolCallCard.displayName = "ToolCallCard";
