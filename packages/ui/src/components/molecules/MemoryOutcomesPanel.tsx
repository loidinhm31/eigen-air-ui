import type { MemoryOutcomeReason, RunEventDto } from "@eigen-air-ui/shared/types";
import {
  formatMemoryOutcomeReason,
  formatMemoryOutcomeState,
} from "@eigen-air-ui/shared/types";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";
import { formatTimestamp } from "../organisms/runInspectorFormatting.js";

export interface MemoryOutcomesPanelProps {
  events: RunEventDto[];
  onNavigate?: (path: string) => void;
}

function useSafeBasePathNavigation() {
  try {
    return useBasePathNavigation();
  } catch {
    return { to: (p: string) => p, navigate: () => undefined };
  }
}

export function MemoryOutcomesPanel({
  events,
  onNavigate,
}: MemoryOutcomesPanelProps) {
  const nav = useSafeBasePathNavigation();
  const handleNavigate = onNavigate ?? nav.navigate;

  const outcomeEvents = events.filter(
    (e) => e.event_kind === "memory_outcome" && Boolean(e.memory_outcome)
  );

  return (
    <section aria-labelledby="run-memory-outcomes-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="run-memory-outcomes-heading" className="text-sm font-semibold">
          Durable memory outcomes
        </h3>
        {outcomeEvents.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {outcomeEvents.length} recorded
          </span>
        )}
      </div>

      {outcomeEvents.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Memory outcome unavailable (no outcome reported by server).
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {outcomeEvents.map((evt) => {
            const outcome = evt.memory_outcome!;
            return (
              <li
                key={evt.event_id}
                className="border-border rounded-md border p-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    {outcome.state === "stored" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        {formatMemoryOutcomeState("stored")}
                      </span>
                    )}
                    {outcome.state === "skipped" && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        {formatMemoryOutcomeState("skipped")}
                      </span>
                    )}
                    {outcome.state === "failed" && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        {formatMemoryOutcomeState("failed")}
                      </span>
                    )}
                    {outcome.state === "unavailable" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {formatMemoryOutcomeState("unavailable")}
                      </span>
                    )}
                    <span className="font-mono text-muted-foreground">
                      {outcome.operation_id}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {outcome.operation_kind}
                    </span>
                  </div>

                  {outcome.episode_reference ? (
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigate(
                          `/memory?episode_id=${encodeURIComponent(
                            outcome.episode_reference!
                          )}`
                        )
                      }
                      className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      aria-label={`View episode ${outcome.episode_reference}`}
                    >
                      View episode →
                    </button>
                  ) : outcome.state === "stored" ? (
                    <span className="text-muted-foreground italic text-xs">
                      source reference redacted (requires exact memory scope)
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span>reason: {formatMemoryOutcomeReason(outcome.reason as MemoryOutcomeReason)}</span>
                  <span>·</span>
                  {outcome.state === "stored" && (
                    <span>
                      committed: {outcome.fact_count ?? 0} facts
                    </span>
                  )}
                  {outcome.state === "failed" && (
                    <span className="text-destructive font-medium">
                      {outcome.fact_count !== null && outcome.fact_count !== undefined
                        ? `partial write: ${outcome.fact_count} facts committed before failure`
                        : "write failed (committed facts unknown)"}
                    </span>
                  )}
                  {outcome.state === "skipped" && (
                    <span>no facts committed (skipped)</span>
                  )}
                  {outcome.state === "unavailable" && (
                    <span>outcome unavailable</span>
                  )}
                  <span>·</span>
                  <span>
                    event #{evt.event_seq} · {formatTimestamp(evt.occurred_at_ms)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
