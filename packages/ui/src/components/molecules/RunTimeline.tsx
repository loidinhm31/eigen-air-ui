import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { ToolSelectionDiagnostic } from "./ToolSelectionDiagnostic.js";

function timestamp(ms: number) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "Not reported";
  return new Date(ms).toLocaleString();
}

export interface RunTimelineProps {
  events: RunEventDto[];
  hasMore?: boolean;
  isLoading?: boolean;
  error?: string;
  onLoadMore?: () => void;
}

export function RunTimeline({
  events,
  hasMore = false,
  isLoading = false,
  error,
  onLoadMore,
}: RunTimelineProps) {
  return (
    <div className="space-y-3">
      <ol aria-label="Run event timeline" className="border-border space-y-2 border-l pl-4">
        {events.map((event) => (
        <li key={event.event_id} className="relative text-sm">
          <span
            aria-hidden
            className="bg-primary absolute -left-[1.31rem] top-1.5 size-2 rounded-full"
          />
          <p className="font-medium">
            {event.event_kind}
            {event.lifecycle_status ? ` — ${event.lifecycle_status}` : ""}
          </p>
          <p
            className="text-muted-foreground text-xs"
            title={`${event.occurred_at_ms} ms since epoch`}
          >
            {timestamp(event.occurred_at_ms)} · sequence {event.event_seq}
          </p>
          {event.safe_error_code && (
            <p className="text-destructive text-xs">Safe error: {event.safe_error_code}</p>
          )}
          {(event.event_kind === "tool_selection" || Boolean(event.tool_selection)) && (
            <div className="mt-2">
              <ToolSelectionDiagnostic
                toolSelection={event.tool_selection}
                occurredAtMs={event.occurred_at_ms}
              />
            </div>
          )}
        </li>
        ))}
      </ol>
      {hasMore && (
        <div className="pl-4">
          <button
            type="button"
            disabled={isLoading}
            onClick={onLoadMore}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            aria-label="Load more events"
          >
            {isLoading ? "Loading more events…" : "Load more events"}
          </button>
          {error && (
            <p role="alert" className="mt-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
