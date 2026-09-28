import type { RunSnapshotDto } from "@eigen-air-ui/shared/types";
import type { StreamStateMap } from "../../stores/runInspectorStore.js";
import { RunTimeline } from "../molecules/RunTimeline.js";
import { MemoryLineagePanel } from "../molecules/MemoryLineagePanel.js";

const displayId = (value?: string | null) => value || "Not reported";

export interface RunInspectorProps {
  snapshot: RunSnapshotDto;
  canRequestDebug: boolean;
  onRequestDebug(): void;
  onClearDebug(): void;
  streamStates?: StreamStateMap;
  onLoadMoreEvents?(): void;
  onLoadMoreTools?(): void;
  onLoadMoreLineage?(): void;
  onLoadMoreDebug?(): void;
}
export function RunInspector({
  snapshot,
  canRequestDebug,
  onRequestDebug,
  onClearDebug,
  streamStates,
  onLoadMoreEvents,
  onLoadMoreTools,
  onLoadMoreLineage,
  onLoadMoreDebug,
}: RunInspectorProps) {
  const { run } = snapshot;
  const debug = snapshot.debug_excerpts ?? [];
  return (
    <article
      aria-label={`Run ${run.run_id}`}
      className="border-border bg-card space-y-5 rounded-lg border p-4"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Run inspector</h2>
          <span className="bg-muted rounded px-2 py-1 text-xs">Status: {run.lifecycle_status}</span>
        </div>
        <p className="text-muted-foreground break-all font-mono text-xs">
          run {run.run_id} · trace {run.trace_id} · parent {displayId(run.parent_run_id)} · root{" "}
          {run.root_run_id}
        </p>
        <p className="text-muted-foreground break-all text-xs">
          session {run.session_id} · request {displayId(run.request_id)} · snapshot sequence{" "}
          {run.snapshot_seq}
        </p>
        {run.redaction.metadata_only && (
          <p className="text-muted-foreground text-xs">
            Metadata-only view; sensitive content is redacted by policy.
          </p>
        )}
      </header>
      <section aria-labelledby="run-usage-heading">
        <h3 id="run-usage-heading" className="text-sm font-semibold">
          Usage
        </h3>
        <p className="text-muted-foreground text-sm">
          {run.usage
            ? `${run.usage.total_tokens ?? "unknown"} total tokens (${run.usage.origin})`
            : "No usage reported by server."}
        </p>
      </section>
      <section aria-labelledby="run-events-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="run-events-heading" className="text-sm font-semibold">
            Events
          </h3>
          {snapshot.events.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {snapshot.events.length} loaded
            </span>
          )}
        </div>
        <RunTimeline
          events={snapshot.events}
          hasMore={Boolean(snapshot.next_event_cursor)}
          isLoading={streamStates?.events.loading}
          error={streamStates?.events.error}
          onLoadMore={onLoadMoreEvents}
        />
      </section>
      <section aria-labelledby="run-tools-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="run-tools-heading" className="text-sm font-semibold">
            Tool calls
          </h3>
          {snapshot.tool_calls.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {snapshot.tool_calls.length} loaded
            </span>
          )}
        </div>
        {snapshot.tool_calls.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No tool call metadata was reported.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {snapshot.tool_calls.map((tool) => (
              <li key={`${tool.tool_call_id}-${tool.ordinal}`} className="border-border rounded border p-2 text-xs">
                <p className="font-medium">
                  {tool.tool_name} — {tool.status}
                </p>
                <p className="text-muted-foreground break-all">
                  tool {tool.tool_call_id} · ordinal {tool.ordinal}
                  {tool.policy_outcome ? ` · policy ${tool.policy_outcome}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {snapshot.next_tool_cursor && (
          <div className="mt-2">
            <button
              type="button"
              disabled={streamStates?.tools.loading}
              onClick={onLoadMoreTools}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              aria-label="Load more tools"
            >
              {streamStates?.tools.loading ? "Loading more tools…" : "Load more tools"}
            </button>
            {streamStates?.tools.error && (
              <p role="alert" className="mt-1 text-destructive text-xs">
                {streamStates.tools.error}
              </p>
            )}
          </div>
        )}
      </section>
      <MemoryLineagePanel
        lineage={snapshot.memory_lineage}
        hasMore={Boolean(snapshot.next_lineage_cursor)}
        isLoading={streamStates?.lineage.loading}
        error={streamStates?.lineage.error}
        onLoadMore={onLoadMoreLineage}
      />
      <section aria-labelledby="run-debug-heading">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 id="run-debug-heading" className="text-sm font-semibold">
              Debug excerpts
            </h3>
            {debug.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {debug.length} loaded
              </span>
            )}
          </div>
          {debug.length > 0 ? (
            <button
              type="button"
              onClick={onClearDebug}
              className="text-xs underline focus-visible:outline focus-visible:outline-2"
            >
              Clear debug
            </button>
          ) : canRequestDebug ? (
            <button
              type="button"
              onClick={onRequestDebug}
              className="text-xs underline focus-visible:outline focus-visible:outline-2"
            >
              Request debug
            </button>
          ) : null}
        </div>
        {debug.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">
            {run.redaction.unavailable_reason
              ? `Debug unavailable: ${run.redaction.unavailable_reason}.`
              : "Debug is not requested."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {debug.map((excerpt) => (
              <li key={excerpt.excerpt_seq} className="border-border rounded border p-2">
                <p
                  className="text-muted-foreground text-xs"
                  title={`${excerpt.expires_at_ms} ms since epoch`}
                >
                  {excerpt.kind} · expires {new Date(excerpt.expires_at_ms).toLocaleString()}
                  {excerpt.truncated ? " · truncated" : ""}
                  {excerpt.redaction_count ? ` · ${excerpt.redaction_count} redactions` : ""}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {excerpt.plaintext}
                </pre>
              </li>
            ))}
          </ul>
        )}
        {snapshot.next_debug_cursor && (
          <div className="mt-2">
            <button
              type="button"
              disabled={streamStates?.debug.loading}
              onClick={onLoadMoreDebug}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              aria-label="Load more debug excerpts"
            >
              {streamStates?.debug.loading ? "Loading more debug excerpts…" : "Load more debug excerpts"}
            </button>
            {streamStates?.debug.error && (
              <p role="alert" className="mt-1 text-destructive text-xs">
                {streamStates.debug.error}
              </p>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
