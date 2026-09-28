import type { RunToolCallDto } from "@eigen-air-ui/shared/types";
import { formatTimestamp, toolDurationText } from "../organisms/runInspectorFormatting.js";

export interface ToolCallsPanelProps {
  toolCalls: RunToolCallDto[];
  hasMore?: boolean;
  isLoading?: boolean;
  error?: string;
  onLoadMore?: () => void;
}

export function ToolCallsPanel({
  toolCalls,
  hasMore = false,
  isLoading = false,
  error,
  onLoadMore,
}: ToolCallsPanelProps) {
  return (
    <section aria-labelledby="run-tools-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="run-tools-heading" className="text-sm font-semibold">
          Tool calls
        </h3>
        {toolCalls.length > 0 && (
          <span className="text-muted-foreground text-xs">{toolCalls.length} loaded</span>
        )}
      </div>
      {toolCalls.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">No tool call metadata was reported.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {toolCalls.map((tool) => (
            <li
              key={`${tool.tool_call_id}-${tool.ordinal}`}
              className="border-border space-y-1 rounded border p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">
                  {tool.tool_name} — {tool.status}
                </p>
                <span className="text-muted-foreground font-mono text-[11px]">
                  duration: {toolDurationText(tool.started_at_ms, tool.completed_at_ms, tool.status)}
                </span>
              </div>
              <p className="text-muted-foreground break-all">
                tool {tool.tool_call_id} · ordinal {tool.ordinal}
                {tool.policy_outcome ? ` · policy ${tool.policy_outcome}` : ""}
                {" · started " + formatTimestamp(tool.started_at_ms)}
                {tool.completed_at_ms != null && tool.completed_at_ms >= tool.started_at_ms
                  ? ` · completed ${formatTimestamp(tool.completed_at_ms)}`
                  : ""}
              </p>
              {tool.safe_error_code && (
                <p className="text-destructive font-mono text-xs">
                  Safe error: {tool.safe_error_code}
                </p>
              )}
              {tool.status === "failed" && !tool.safe_error_code && (
                <p className="text-destructive text-xs">Failed (no error code reported)</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="mt-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onLoadMore}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            aria-label="Load more tools"
          >
            {isLoading ? "Loading more tools…" : "Load more tools"}
          </button>
          {error && (
            <p role="alert" className="mt-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
