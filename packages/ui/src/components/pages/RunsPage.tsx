import * as React from "react";
import type { RunEventDto, RunSummaryDto } from "@nonclaw-ui/shared/types";
import { HttpRunAdapter, type RunAccessContext } from "../../adapters/http/HttpRunAdapter.js";
import { getChatService } from "../../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useRunInspectorStore } from "../../stores/runInspectorStore.js";
import { RunInspector } from "../organisms/RunInspector.js";
import { Button } from "../atoms/Button.js";
const NO_RUN_ACCESS: RunAccessContext = {};
/** Server-authenticated state supplied by the embedding host; defaults deny. */
interface RunsPageProps { access?: RunAccessContext }
export function RunsPage({ access = NO_RUN_ACCESS }: RunsPageProps) {
  const url = useConnectionStore((state) => state.url);
  const { authToken, capabilities, identityKey } = access;
  const {
    snapshots,
    debugExpiresAtMs,
    selectedRunId,
    status,
    error,
    select,
    begin,
    snapshot,
    fail,
    clear,
    clearDebug,
    expire,
    operation,
    beginOperation,
    completeOperation,
    failOperation,
    evict,
  } = useRunInspectorStore();
  const [runs, setRuns] = React.useState<RunSummaryDto[]>([]);
  const lifecycleGeneration = React.useRef(0);
  const listAbort = React.useRef<AbortController | undefined>(undefined);
  const detailAbort = React.useRef<AbortController | undefined>(undefined);
  const mutationAbort = React.useRef<AbortController | undefined>(undefined);
  const correlationEnabled = React.useRef(true);
  // Includes the role/capability boundary; it remains component-local and is never persisted.
  const accessKey = `${identityKey ?? ""}\u0000${authToken ?? ""}\u0000${[...(capabilities ?? [])].sort().join(",")}`;
  const previousAccessKey = React.useRef<string | undefined>(undefined);
  const adapter = React.useMemo(
    () => new HttpRunAdapter(url.replace(/\/+$/, ""), { authToken, capabilities, identityKey }),
    [authToken, capabilities, identityKey, url]
  );
  const selected = selectedRunId ? snapshots[selectedRunId] : undefined;
  const canRequestDebug = capabilities?.has("run:read:debug") ?? false;
  const canExport = capabilities?.has("run:export") ?? false;
  const canDelete = capabilities?.has("run:delete") ?? false;
  const clearUnavailable = React.useCallback(
    (reason: "denied" | "not-found") => {
      // Invalidate every in-flight request and the currently subscribed live
      // stream before clearing state. A late frame must not repopulate queues
      // after an authorization/no-oracle boundary.
      lifecycleGeneration.current += 1;
      listAbort.current?.abort();
      detailAbort.current?.abort();
      mutationAbort.current?.abort();
      correlationEnabled.current = false;
      setRuns([]);
      clear(reason);
    },
    [clear]
  );
  const handleReadError = React.useCallback(
    (reason: unknown) => {
      const statusCode = (reason as Error & { status?: number }).status;
      if (statusCode === 401 || statusCode === 403) {
        clearUnavailable("denied");
      } else if (statusCode === 404) {
        clearUnavailable("not-found");
      } else {
        fail(reason);
      }
    },
    [clearUnavailable, fail]
  );
  const load = React.useCallback(async () => {
    const generation = lifecycleGeneration.current;
    listAbort.current?.abort();
    const controller = new AbortController();
    listAbort.current = controller;
    begin();
    try {
      const result = await adapter.list(undefined, 50, controller.signal);
      if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
      correlationEnabled.current = true;
      setRuns(result.runs);
    } catch (reason) {
      if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
      handleReadError(reason);
    }
  }, [adapter, begin, handleReadError]);
  const open = React.useCallback(
    async (runId: string, includeDebug = false) => {
      const generation = lifecycleGeneration.current;
      detailAbort.current?.abort();
      const controller = new AbortController();
      detailAbort.current = controller;
      select(runId);
      begin();
      try {
        const result = await adapter.get(runId, includeDebug, controller.signal);
        const activeRunId = useRunInspectorStore.getState().selectedRunId;
        if (
          controller.signal.aborted ||
          generation !== lifecycleGeneration.current ||
          activeRunId !== runId
        )
          return;
        correlationEnabled.current = true;
        snapshot(result);
      } catch (reason) {
        if (
          controller.signal.aborted ||
          generation !== lifecycleGeneration.current ||
          useRunInspectorStore.getState().selectedRunId !== runId
        )
          return;
        handleReadError(reason);
      }
    },
    [adapter, begin, handleReadError, select, snapshot]
  );
  const exportRun = React.useCallback(
    async (runId: string) => {
      const generation = lifecycleGeneration.current;
      mutationAbort.current?.abort();
      const controller = new AbortController();
      mutationAbort.current = controller;
      beginOperation("export", runId);
      try {
        const blob = await adapter.export(runId, controller.signal);
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = `${runId}.json`;
        link.click();
        URL.revokeObjectURL(href);
        completeOperation("export", runId);
      } catch (reason) {
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        const statusCode = (reason as Error & { status?: number }).status;
        if (statusCode === 401 || statusCode === 403 || statusCode === 404)
          clearUnavailable(statusCode === 404 ? "not-found" : "denied");
        else failOperation("export", runId, reason);
      }
    },
    [adapter, beginOperation, clearUnavailable, completeOperation, failOperation]
  );
  const deleteRun = React.useCallback(
    async (runId: string) => {
      const generation = lifecycleGeneration.current;
      mutationAbort.current?.abort();
      const controller = new AbortController();
      mutationAbort.current = controller;
      beginOperation("delete", runId);
      try {
        await adapter.delete(runId, controller.signal);
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        // Do not optimistically hide data: evict only after the server accepts DELETE.
        evict(runId);
        setRuns((current) => current.filter((run) => run.run_id !== runId));
        completeOperation("delete", runId);
      } catch (reason) {
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        const statusCode = (reason as Error & { status?: number }).status;
        if (statusCode === 401 || statusCode === 403 || statusCode === 404)
          clearUnavailable(statusCode === 404 ? "not-found" : "denied");
        else failOperation("delete", runId, reason);
      }
    },
    [adapter, beginOperation, clearUnavailable, completeOperation, evict, failOperation]
  );
  React.useEffect(() => {
    void load();
    return () => {
      lifecycleGeneration.current += 1;
      listAbort.current?.abort();
      detailAbort.current?.abort();
      mutationAbort.current?.abort();
      correlationEnabled.current = false;
      clear();
    };
  }, [clear, load]);
  React.useEffect(() => {
    const changed = previousAccessKey.current !== undefined && previousAccessKey.current !== accessKey;
    previousAccessKey.current = accessKey;
    if (!changed) return;
    lifecycleGeneration.current += 1;
    listAbort.current?.abort();
    detailAbort.current?.abort();
    mutationAbort.current?.abort();
    correlationEnabled.current = false;
    setRuns([]);
    clear("denied");
    void load();
  }, [accessKey, clear, load]);
  React.useEffect(() => {
    const service = getChatService();
    const unsubscribe = service.subscribeRunCorrelation?.((frame) => {
      if (!correlationEnabled.current) return;
      const runId = frame.run_id;
      if (
        !runId ||
        !frame.event_id ||
        frame.event_seq === undefined ||
        frame.occurred_at_ms === undefined
      ) {
        const activeRunId = useRunInspectorStore.getState().selectedRunId;
        if (
          activeRunId &&
          (runId === activeRunId || (!runId && frame.snapshot_refetch_required === true))
        ) {
          useRunInspectorStore.getState().event(activeRunId, undefined);
        }
        return;
      }
      const event: RunEventDto = {
        event_id: frame.event_id,
        event_seq: frame.event_seq,
        event_kind: frame.event,
        occurred_at_ms: frame.occurred_at_ms,
        lifecycle_status: frame.lifecycle_status,
      };
      useRunInspectorStore.getState().event(runId, event);
    });
    const reconnect = service.onRunReconnect?.(() => {
      void load();
      const activeRunId = useRunInspectorStore.getState().selectedRunId;
      if (activeRunId) void open(activeRunId);
    });
    return () => { unsubscribe?.(); reconnect?.(); };
  }, [load, open]);
  React.useEffect(() => {
    if (status === "reconciling" && selectedRunId) void open(selectedRunId);
  }, [open, selectedRunId, status]);
  React.useEffect(() => {
    if (debugExpiresAtMs === undefined) return;
    const timer = window.setTimeout(() => expire(), Math.max(0, debugExpiresAtMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [debugExpiresAtMs, expire]);
  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="border-border bg-card overflow-auto rounded-lg border p-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-semibold">Runs</h1>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <p className="text-muted-foreground mb-3 text-xs">Snapshots are authoritative; live events reconcile through REST.</p>
        <ul className="space-y-1" aria-label="Available runs">
          {runs.map((run) => (
            <li key={run.run_id}>
              <button
                type="button"
                onClick={() => void open(run.run_id)}
                className="hover:bg-accent w-full rounded px-2 py-2 text-left focus-visible:outline focus-visible:outline-2"
                aria-current={run.run_id === selectedRunId ? "page" : undefined}
                aria-label={run.run_id}
              >
                <span className="block truncate font-mono text-xs">{run.run_id}</span>
                <span className="text-muted-foreground block text-xs">Status: {run.lifecycle_status}</span>
              </button>
            </li>
          ))}
        </ul>
        {runs.length === 0 && status !== "loading" && (
          <p className="text-muted-foreground text-sm">No runs available.</p>
        )}
      </aside>
      <main className="min-w-0 overflow-auto" aria-live="polite">
        {status === "loading" && <p role="status">Loading run snapshot…</p>}
        {status === "reconciling" && (
          <p role="status">Live sequence gap detected; reconciling from snapshot…</p>
        )}
        {status === "failed" && (
          <p role="alert" className="text-destructive">
            {error ?? "Run request failed."}
          </p>
        )}
        {(status === "denied" || status === "not-found") && <p role="alert">Run unavailable.</p>}
        {status === "deleted" && <p role="status">Run deleted.</p>}
        {operation?.status === "pending" && (
          <p role="status">{operation.kind === "delete" ? "Deleting" : "Exporting"} run…</p>
        )}
        {operation?.status === "success" && operation.kind === "export" && (
          <p role="status">Run exported.</p>
        )}
        {operation?.status === "failed" && (
          <p role="alert" className="text-destructive">{operation.error}</p>
        )}
        {selected && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {canExport && (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={operation?.kind === "export" && operation.status === "pending"}
                  onClick={() => void exportRun(selected.run.run_id)}
                >
                  Export
                </Button>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="destructive"
                  isLoading={operation?.kind === "delete" && operation.status === "pending"}
                  onClick={() => void deleteRun(selected.run.run_id)}
                >
                  Delete
                </Button>
              )}
            </div>
            <RunInspector
              snapshot={selected}
              canRequestDebug={canRequestDebug}
              onRequestDebug={() => void open(selected.run.run_id, true)}
              onClearDebug={() => clearDebug(selected.run.run_id)}
            />
          </>
        )}
      </main>
    </div>
  );
}
