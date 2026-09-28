import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { ToolSelectionDiagnostic } from "./ToolSelectionDiagnostic.js";

export interface ToolDecisionsPanelProps {
  events: RunEventDto[];
}

export function ToolDecisionsPanel({ events }: ToolDecisionsPanelProps) {
  const toolSelectionEvents = events.filter(
    (e) => e.event_kind === "tool_selection" || Boolean(e.tool_selection)
  );

  return (
    <section aria-labelledby="run-tool-decisions-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="run-tool-decisions-heading" className="text-sm font-semibold">
          Tool selection decisions
        </h3>
        {toolSelectionEvents.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {toolSelectionEvents.length} recorded
          </span>
        )}
      </div>
      {toolSelectionEvents.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No tool selection diagnostics reported.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {toolSelectionEvents.map((evt) => (
            <ToolSelectionDiagnostic
              key={evt.event_id}
              toolSelection={evt.tool_selection}
              occurredAtMs={evt.occurred_at_ms}
            />
          ))}
        </div>
      )}
    </section>
  );
}
