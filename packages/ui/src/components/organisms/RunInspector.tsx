import type { RunSnapshotDto, RunTreeNodeDto, ToolApprovalSnapshot } from "@eigen-air-ui/shared/types";
import type { StreamStateMap } from "../../stores/runInspectorStore.js";
import { DelegationLifecyclePanel } from "../molecules/DelegationLifecyclePanel.js";
import { RunTimeline } from "../molecules/RunTimeline.js";
import { MemoryLineagePanel } from "../molecules/MemoryLineagePanel.js";
import { MemoryOutcomesPanel } from "../molecules/MemoryOutcomesPanel.js";
import { RequestProvenancePanel } from "../molecules/RequestProvenancePanel.js";
import { TaskOutcomesPanel } from "../molecules/TaskOutcomesPanel.js";
import { ToolDecisionsPanel } from "../molecules/ToolDecisionsPanel.js";
import { ToolCallsPanel } from "../molecules/ToolCallsPanel.js";
import { HistoricalToolApprovalsPanel } from "../molecules/HistoricalToolApprovalsPanel.js";
import { formatTimestamp, runDurationText } from "./runInspectorFormatting.js";

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
  runTreeNodes?: RunTreeNodeDto[] | null;
  runTreeLoading?: boolean;
  runTreeError?: string;
  onSelectRun?(runId: string): void;
  historicalApprovals?: ToolApprovalSnapshot[];
  historicalApprovalsLoading?: boolean;
  historicalApprovalsError?: string;
  onRefreshHistoricalApprovals?(): void;
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
  runTreeNodes,
  runTreeLoading,
  runTreeError,
  onSelectRun,
  historicalApprovals,
  historicalApprovalsLoading,
  historicalApprovalsError,
  onRefreshHistoricalApprovals,
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
          run {run.run_id} · trace {run.trace_id} · parent {run.parent_run_id || "Not reported"} · root{" "}
          {run.root_run_id}
        </p>
        <p className="text-muted-foreground break-all text-xs">
          session {run.session_id} · request {run.request_id || "Not reported"} · snapshot sequence{" "}
          {run.snapshot_seq}
        </p>
        <p className="text-muted-foreground break-all text-xs">
          provider {run.provider_id} · agent {run.agent_id} · channel {run.channel}
        </p>
        <p className="text-muted-foreground break-all text-xs">
          timing: started {formatTimestamp(run.started_at_ms)} · duration{" "}
          {runDurationText(run.started_at_ms, run.completed_at_ms, run.updated_at_ms)}
          {run.completed_at_ms != null && run.completed_at_ms >= run.started_at_ms
            ? ` · completed ${formatTimestamp(run.completed_at_ms)}`
            : ""}
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
            ? `${run.usage.total_tokens != null ? run.usage.total_tokens : "unknown"} total tokens (${run.usage.origin}) · prompt: ${run.usage.prompt_tokens != null ? run.usage.prompt_tokens : "unknown"} · completion: ${run.usage.completion_tokens != null ? run.usage.completion_tokens : "unknown"}`
            : "No usage reported by server."}
        </p>
      </section>
      <DelegationLifecyclePanel
        runId={run.run_id}
        parentRunId={run.parent_run_id || snapshot.task_progress?.parent_run_id}
        rootRunId={run.root_run_id || snapshot.task_progress?.root_run_id}
        taskProgress={snapshot.task_progress}
        runTreeNodes={runTreeNodes}
        runTreeLoading={runTreeLoading}
        runTreeError={runTreeError}
        onSelectRun={onSelectRun}
      />
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
      <ToolDecisionsPanel events={snapshot.events} />
      <ToolCallsPanel
        toolCalls={snapshot.tool_calls}
        hasMore={Boolean(snapshot.next_tool_cursor)}
        isLoading={streamStates?.tools.loading}
        error={streamStates?.tools.error}
        onLoadMore={onLoadMoreTools}
      />
      <HistoricalToolApprovalsPanel
        approvals={historicalApprovals}
        toolCalls={snapshot.tool_calls}
        isLoading={historicalApprovalsLoading}
        error={historicalApprovalsError}
        onRefresh={onRefreshHistoricalApprovals}
      />
      <MemoryLineagePanel
        lineage={snapshot.memory_lineage}
        hasMore={Boolean(snapshot.next_lineage_cursor)}
        isLoading={streamStates?.lineage.loading}
        error={streamStates?.lineage.error}
        onLoadMore={onLoadMoreLineage}
      />
      <MemoryOutcomesPanel events={snapshot.events} />
      <RequestProvenancePanel events={snapshot.events} />
      <TaskOutcomesPanel events={snapshot.events} />
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
