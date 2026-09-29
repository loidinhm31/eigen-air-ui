import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { formatTimestamp } from "../organisms/runInspectorFormatting.js";

export interface TaskOutcomesPanelProps {
  events: RunEventDto[];
}

export function formatTaskOutcomeReason(reason: string): string {
  switch (reason) {
    case "valid":
      return "Valid (all checks passed)";
    case "schema_mismatch":
      return "Schema mismatch";
    case "missing_required_field":
      return "Missing required field";
    case "unreferenced_citation":
      return "Unreferenced citation";
    case "quote_too_short":
      return "Evidence quote too short (< 40 chars)";
    case "source_count_floor_not_met":
      return "Source floor not met (< 3 sources)";
    case "artifact_missing":
      return "Artifact file missing";
    case "artifact_oversized":
      return "Artifact oversized (> 64 KiB)";
    case "workspace_violation":
      return "Workspace path violation";
    case "io_error":
      return "Filesystem I/O error";
    default:
      return reason;
  }
}

export function TaskOutcomesPanel({ events }: TaskOutcomesPanelProps) {
  const outcomeEvents = events.filter(
    (e) => e.event_kind === "task_outcome" && Boolean(e.task_outcome)
  );

  return (
    <section aria-labelledby="run-task-outcomes-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="run-task-outcomes-heading" className="text-sm font-semibold">
          Task outcome verification
        </h3>
        {outcomeEvents.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {outcomeEvents.length} evaluated
          </span>
        )}
      </div>

      {outcomeEvents.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No task outcome evaluation recorded for this run.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {outcomeEvents.map((evt) => {
            const outcome = evt.task_outcome!;
            return (
              <li
                key={evt.event_id}
                className="border-border rounded-md border p-2.5 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    {outcome.status === "passed" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        PASSED
                      </span>
                    )}
                    {outcome.status === "failed" && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                        FAILED
                      </span>
                    )}
                    {outcome.status === "error" && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                        ERROR
                      </span>
                    )}
                    <span className="font-mono text-muted-foreground">
                      {outcome.checker_id}:{outcome.checker_version}
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {formatTimestamp(outcome.evaluated_at_ms)}
                  </span>
                </div>

                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Target: </span>
                    <span className="font-mono">{outcome.artifact_path}</span>
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Status Reason: </span>
                    <span>{formatTaskOutcomeReason(outcome.reason)}</span>
                  </div>
                  {outcome.details && (
                    <div>
                      <span className="font-medium text-foreground">Details: </span>
                      <span>{outcome.details}</span>
                    </div>
                  )}
                  {outcome.artifact_digest && (
                    <div className="truncate">
                      <span className="font-medium text-foreground">SHA-256: </span>
                      <span className="font-mono text-[10px]">{outcome.artifact_digest}</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 text-[10px] text-muted-foreground/75 italic">
                  Deterministic evaluation independent of run lifecycle. Model cannot self-grant verification.
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
