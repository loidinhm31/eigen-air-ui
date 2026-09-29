import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { formatTimestamp } from "../organisms/runInspectorFormatting.js";

export interface RequestProvenancePanelProps {
  events: RunEventDto[];
}

export function RequestProvenancePanel({ events }: RequestProvenancePanelProps) {
  const provenanceEvents = events.filter(
    (e) => e.event_kind === "request_provenance" && Boolean(e.request_provenance)
  );

  return (
    <section aria-labelledby="run-request-provenance-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="run-request-provenance-heading" className="text-sm font-semibold">
          Request provenance
        </h3>
        {provenanceEvents.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {provenanceEvents.length} recorded
          </span>
        )}
      </div>

      {provenanceEvents.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Request provenance unavailable (no provenance reported by server).
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {provenanceEvents.map((evt) => {
            const prov = evt.request_provenance!;
            return (
              <li
                key={evt.event_id}
                className="border-border rounded-md border p-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                      {prov.schema_version}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      req {prov.logical_request_id}
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {formatTimestamp(evt.occurred_at_ms)}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-1 text-muted-foreground sm:grid-cols-2">
                  <div>
                    <span className="font-medium text-foreground">Provider: </span>
                    {prov.provider_id}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Profile: </span>
                    {prov.provider_profile_id ?? "Redacted / Unknown"}
                    {prov.provider_profile_revision != null
                      ? ` (rev ${prov.provider_profile_revision})`
                      : ""}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Model: </span>
                    {prov.model ?? "Unknown / Not reported"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Selected skill: </span>
                    {prov.selected_skill_id ?? "None"}
                    {prov.skill_content_revision
                      ? ` (${prov.skill_content_revision})`
                      : ""}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Prompt format: </span>
                    {prov.prompt_format_version}
                  </div>
                </div>

                {prov.section_summaries.length > 0 && (
                  <div className="mt-2 border-t border-border pt-1.5">
                    <span className="font-medium text-foreground">Prompt sections:</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {prov.section_summaries.map((s) => (
                        <span
                          key={s.section}
                          className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                            s.present
                              ? "bg-muted text-foreground"
                              : "bg-muted/50 text-muted-foreground line-through"
                          }`}
                        >
                          {s.section}
                          {s.present && s.estimated_tokens != null
                            ? ` (~${s.estimated_tokens}t)`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
