import * as React from "react";
import { useLocation } from "react-router-dom";
import type { RunEventDto, RunSummaryDto, RunTreeNodeDto } from "@eigen-air-ui/shared/types";
import { HttpRunAdapter, type RunAccessContext } from "../../adapters/http/HttpRunAdapter.js";
import {
  HttpToolApprovalAdapter,
  ToolApprovalHttpError,
} from "../../adapters/http/HttpToolApprovalAdapter.js";
import { getChatService, getServiceAccessContext } from "../../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useRunInspectorStore } from "../../stores/runInspectorStore.js";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";
import { RunInspector } from "../organisms/RunInspector.js";
import { Button } from "../atoms/Button.js";

function useSafeBasePathNavigation() {
  try {
    return useBasePathNavigation();
  } catch {
    return { to: (p: string) => p, navigate: () => undefined };
  }
}

function useSafeLocationSearch(): string {
  try {
    return useLocation().search;
  } catch {
    return typeof window !== "undefined" ? window.location.search : "";
  }
}

/** Server-authenticated state supplied by the embedding host; defaults deny. */
interface RunsPageProps { access?: RunAccessContext }
export function RunsPage({ access: propAccess }: RunsPageProps) {
  const url = useConnectionStore((state) => state.url);
  const access = React.useMemo(() => {
    const serviceAccess = getServiceAccessContext();
    if (!propAccess) return serviceAccess;
    return {
      ...serviceAccess,
      ...propAccess,
      authToken: propAccess.authToken ?? serviceAccess.authToken,
      capabilities: propAccess.capabilities ?? serviceAccess.capabilities,
    };
  }, [propAccess]);
  const { authToken, capabilities, identityKey } = access;
  const {
    snapshots,
    debugExpiresAtMs,
    selectedRunId,
    status,
    error,
    streams,
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
    beginStream,
    pageStream,
    failStream,
  } = useRunInspectorStore();
  const [runs, setRuns] = React.useState<RunSummaryDto[]>([]);
  const [listNextCursor, setListNextCursor] = React.useState<string | null>(null);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState<string | undefined>(undefined);
  const [runTreeNodes, setRunTreeNodes] = React.useState<RunTreeNodeDto[] | null>(null);
  const [runTreeLoading, setRunTreeLoading] = React.useState(false);
  const [runTreeError, setRunTreeError] = React.useState<string | undefined>(undefined);
  const runTreeAbort = React.useRef<AbortController | undefined>(undefined);
  const { navigate } = useSafeBasePathNavigation();
  const locationSearch = useSafeLocationSearch();
  const searchParams = React.useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const urlSessionId = searchParams.get("session_id")?.trim() || undefined;
  const urlRunId = searchParams.get("run_id")?.trim() || undefined;
  const lastOpenedRunId = React.useRef<string | undefined>(undefined);
  const previousSessionId = React.useRef<string | undefined>(urlSessionId);

  const updateUrl = React.useCallback(
    (newRunId?: string, newSessionId?: string) => {
      const params = new URLSearchParams();
      if (newSessionId) params.set("session_id", newSessionId);
      if (newRunId) params.set("run_id", newRunId);
      const qs = params.toString();
      navigate(`/runs${qs ? `?${qs}` : ""}`);
    },
    [navigate]
  );
  const lifecycleGeneration = React.useRef(0);
  const listAbort = React.useRef<AbortController | undefined>(undefined);
  const detailAbort = React.useRef<AbortController | undefined>(undefined);
  const mutationAbort = React.useRef<AbortController | undefined>(undefined);
  const debugAbort = React.useRef<AbortController | undefined>(undefined);
  const correlationEnabled = React.useRef(true);
  // Includes the role/capability boundary; it remains component-local and is never persisted.
  const accessKey = `${identityKey ?? ""}\u0000${authToken ?? ""}\u0000${[...(capabilities ?? [])].sort().join(",")}`;
  const previousAccessKey = React.useRef<string | undefined>(undefined);
  const adapter = React.useMemo(
    () => new HttpRunAdapter(url.replace(/\/+$/, ""), { authToken, capabilities, identityKey }),
    [authToken, capabilities, identityKey, url]
  );
  const toolApprovalAdapter = React.useMemo(
    () =>
      new HttpToolApprovalAdapter(url.replace(/\/+$/, ""), {
        authToken,
        capabilities,
        identityKey,
      }),
    [authToken, capabilities, identityKey, url]
  );
  const [historicalApprovalsLoading, setHistoricalApprovalsLoading] = React.useState(false);
  const [historicalApprovalsError, setHistoricalApprovalsError] = React.useState<string | undefined>(undefined);
  const approvalsAbort = React.useRef<AbortController | undefined>(undefined);
  const setHistoricalApprovals = useRunInspectorStore((state) => state.setHistoricalApprovals);
  const historicalApprovals = useRunInspectorStore((state) =>
    selectedRunId && state.historicalApprovals ? state.historicalApprovals[selectedRunId] : undefined
  );
  const loadHistoricalApprovals = React.useCallback(
    async (runId: string, sessionId: string) => {
      approvalsAbort.current?.abort();
      const controller = new AbortController();
      approvalsAbort.current = controller;
      const generation = lifecycleGeneration.current;
      setHistoricalApprovalsLoading(true);
      setHistoricalApprovalsError(undefined);
      try {
        const response = await toolApprovalAdapter.list(
          { sessionId, runId, limit: 100 },
          controller.signal
        );
        if (
          controller.signal.aborted ||
          generation !== lifecycleGeneration.current ||
          useRunInspectorStore.getState().selectedRunId !== runId
        ) {
          return;
        }
        setHistoricalApprovals(runId, response.approvals);
      } catch (err) {
        if (
          controller.signal.aborted ||
          generation !== lifecycleGeneration.current ||
          useRunInspectorStore.getState().selectedRunId !== runId
        ) {
          return;
        }
        setHistoricalApprovals(runId, []);
        if (
          err instanceof ToolApprovalHttpError &&
          (err.kind === "unauthorized" || err.kind === "forbidden")
        ) {
          setHistoricalApprovalsError("Tool approvals unavailable (not authorized)");
        } else if (err instanceof ToolApprovalHttpError && err.kind === "not_found") {
          setHistoricalApprovalsError("Tool approvals unavailable (not found)");
        } else if (err instanceof Error) {
          setHistoricalApprovalsError(err.message);
        } else {
          setHistoricalApprovalsError("Failed to load tool approvals");
        }
        if (
          !controller.signal.aborted &&
          generation === lifecycleGeneration.current &&
          useRunInspectorStore.getState().selectedRunId === runId
        ) {
          setHistoricalApprovalsLoading(false);
        }
      }
    },
    [setHistoricalApprovals, toolApprovalAdapter]
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
      runTreeAbort.current?.abort();
      approvalsAbort.current?.abort();
      setHistoricalApprovalsLoading(false);
      setHistoricalApprovalsError(undefined);
      correlationEnabled.current = false;
      setRuns([]);
      setRunTreeNodes(null);
      setRunTreeLoading(false);
      setRunTreeError(undefined);
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
  const load = React.useCallback(
    async (cursor?: string) => {
      const generation = lifecycleGeneration.current;
      if (!cursor) {
        listAbort.current?.abort();
      }
      const controller = new AbortController();
      if (!cursor) {
        listAbort.current = controller;
        begin();
      }
      setListLoading(true);
      setListError(undefined);
      try {
        const result = await adapter.list({
          sessionId: urlSessionId,
          cursor,
          limit: 50,
          signal: controller.signal,
        });
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        correlationEnabled.current = true;
        setRuns((current) => {
          if (!cursor) return result.runs;
          const existingIds = new Set(current.map((r) => r.run_id));
          const merged = [...current];
          for (const r of result.runs) {
            if (!existingIds.has(r.run_id)) {
              existingIds.add(r.run_id);
              merged.push(r);
            }
          }
          return merged;
        });
        setListNextCursor(result.next_cursor ?? null);
      } catch (reason) {
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        if (!cursor) {
          handleReadError(reason);
        } else {
          const statusCode = (reason as Error & { status?: number }).status;
          if (statusCode === 401 || statusCode === 403) {
            clearUnavailable("denied");
          } else if (statusCode === 404) {
            clearUnavailable("not-found");
          } else {
            setListError(reason instanceof Error ? reason.message : "Failed to load more runs");
          }
        }
      } finally {
        if (generation === lifecycleGeneration.current) {
          setListLoading(false);
        }
      }
    },
    [adapter, begin, handleReadError, urlSessionId]
  );
  const open = React.useCallback(
    async (runId: string, includeDebug = false) => {
      lastOpenedRunId.current = runId;
      const generation = lifecycleGeneration.current;
      detailAbort.current?.abort();
      const controller = new AbortController();
      detailAbort.current = controller;
      select(runId);
      const reqGen = begin();
      try {
        const result = await adapter.get(runId, {
          includeDebug,
          signal: controller.signal,
        });
        const activeRunId = useRunInspectorStore.getState().selectedRunId;
        if (
          controller.signal.aborted ||
          generation !== lifecycleGeneration.current ||
          activeRunId !== runId
        )
          return;
        correlationEnabled.current = true;
        snapshot(result, reqGen);
        void loadHistoricalApprovals(result.run.run_id, result.run.session_id);
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
    [adapter, begin, handleReadError, loadHistoricalApprovals, select, snapshot]
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
      debugAbort.current?.abort();
      runTreeAbort.current?.abort();
      correlationEnabled.current = false;
      approvalsAbort.current?.abort();
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
    debugAbort.current?.abort();
    runTreeAbort.current?.abort();
    correlationEnabled.current = false;
    approvalsAbort.current?.abort();
    setHistoricalApprovalsLoading(false);
    setHistoricalApprovalsError(undefined);
    setRuns([]);
    setListNextCursor(null);
    setRunTreeNodes(null);
    setRunTreeLoading(false);
    setRunTreeError(undefined);
    clear("denied");
    void load();
  }, [accessKey, clear, load]);
  const rootRunSessionId = selected?.run.root_run_id ? snapshots[selected.run.root_run_id]?.run.session_id : undefined;

  React.useEffect(() => {
    runTreeAbort.current?.abort();
    setRunTreeNodes(null);
    setRunTreeError(undefined);

    if (!selected) {
      setRunTreeLoading(false);
      return;
    }

    const generation = lifecycleGeneration.current;

    let rootSessionId: string | undefined = selected.task_progress?.root_session_id;
    if (!rootSessionId) {
      if (!selected.run.parent_run_id || selected.run.root_run_id === selected.run.run_id) {
        rootSessionId = selected.run.session_id;
      } else if (selected.run.root_run_id && rootRunSessionId) {
        rootSessionId = rootRunSessionId;
      }
    }
    if (!rootSessionId) {
      if (selected.run.root_run_id && selected.run.root_run_id !== selected.run.run_id) {
        adapter
          .get(selected.run.root_run_id)
          .then((rootSnapshot) => {
            if (generation !== lifecycleGeneration.current) return;
            useRunInspectorStore.getState().snapshot(rootSnapshot);
          })
          .catch(() => undefined);
      }
      setRunTreeLoading(false);
      return;
    }

    const controller = new AbortController();
    runTreeAbort.current = controller;
    setRunTreeLoading(true);

    adapter
      .getRunTree(rootSessionId, controller.signal)
      .then((nodes) => {
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        setRunTreeNodes(nodes);
        setRunTreeLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || generation !== lifecycleGeneration.current) return;
        setRunTreeError(err instanceof Error ? err.message : "Run tree unavailable");
        setRunTreeLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [adapter, selected, rootRunSessionId]);
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
    const unsubscribeProgress = service.subscribeTaskProgress?.((progressEvent) => {
      if (!correlationEnabled.current) return;
      const targetRunId = progressEvent.run_id || progressEvent.payload.subagent_run_id;
      const activeRunId = useRunInspectorStore.getState().selectedRunId;
      if (targetRunId) {
        useRunInspectorStore.getState().taskProgressEvent(targetRunId, progressEvent);
      } else if (activeRunId && progressEvent.payload.snapshot_refetch_required) {
        useRunInspectorStore.getState().taskProgressEvent(activeRunId, progressEvent);
      }
    });
    const reconnect = service.onRunReconnect?.(() => {
      void load();
      const activeRunId = useRunInspectorStore.getState().selectedRunId;
      if (activeRunId) void open(activeRunId);
    });
    return () => {
      unsubscribe?.();
      unsubscribeProgress?.();
      reconnect?.();
    };
  }, [load, open]);
  React.useEffect(() => {
    if (urlRunId && urlRunId !== lastOpenedRunId.current) {
      void open(urlRunId);
    }
  }, [open, urlRunId]);
  React.useEffect(() => {
    if (previousSessionId.current !== urlSessionId) {
      previousSessionId.current = urlSessionId;
      setRuns([]);
      setListNextCursor(null);
      void load();
    }
  }, [load, urlSessionId]);
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
        {urlSessionId && (
          <div className="mb-2 flex items-center justify-between rounded bg-muted/60 p-2 text-xs">
            <span className="truncate">
              Session: <strong className="font-mono">{urlSessionId}</strong>
            </span>
            <button
              type="button"
              onClick={() => updateUrl(selectedRunId, undefined)}
              className="ml-2 font-medium text-primary underline hover:text-primary/80"
              aria-label="Clear session filter"
            >
              Clear
            </button>
          </div>
        )}
        <ul className="space-y-1" aria-label="Available runs">
          {runs.map((run) => (
            <li key={run.run_id}>
              <button
                type="button"
                onClick={() => {
                  updateUrl(run.run_id, urlSessionId);
                  void open(run.run_id);
                }}
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
        {listNextCursor && (
          <div className="mt-2 pt-2 border-t border-border">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              isLoading={listLoading}
              disabled={listLoading}
              onClick={() => void load(listNextCursor)}
            >
              Load more runs
            </Button>
            {listError && (
              <p role="alert" className="mt-1 text-destructive text-xs">
                {listError}
              </p>
            )}
          </div>
        )}
        {runs.length === 0 && status !== "loading" && !listLoading && (
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
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
              {canExport && (
                <span role="note" className="text-muted-foreground text-xs">
                  Export includes snapshot page only; additional history remains on server.
                </span>
              )}
            </div>
            <RunInspector
              snapshot={selected}
              canRequestDebug={canRequestDebug}
              onRequestDebug={() => void open(selected.run.run_id, true)}
              onClearDebug={() => {
                debugAbort.current?.abort();
                clearDebug(selected.run.run_id);
              }}
              streamStates={streams}
              runTreeNodes={runTreeNodes}
              runTreeLoading={runTreeLoading}
              runTreeError={runTreeError}
              onSelectRun={(targetRunId) => {
                updateUrl(targetRunId, urlSessionId);
                void open(targetRunId);
              }}
              historicalApprovals={historicalApprovals}
              historicalApprovalsLoading={historicalApprovalsLoading}
              historicalApprovalsError={historicalApprovalsError}
              onRefreshHistoricalApprovals={() => {
                if (selected) void loadHistoricalApprovals(selected.run.run_id, selected.run.session_id);
              }}
              onLoadMoreEvents={async () => {
                if (!selectedRunId || !selected.next_event_cursor) return;
                if (!beginStream("events")) return;
                const gen = useRunInspectorStore.getState().refreshGeneration ?? 0;
                try {
                  const page = await adapter.get(selectedRunId, {
                    eventCursor: selected.next_event_cursor,
                    includeDebug: false,
                  });
                  pageStream(selectedRunId, "events", page, gen);
                } catch (err) {
                  const statusCode = (err as Error & { status?: number }).status;
                  if (statusCode === 401 || statusCode === 403) {
                    clearUnavailable("denied");
                  } else if (statusCode === 404) {
                    clearUnavailable("not-found");
                  } else if (
                    useRunInspectorStore.getState().refreshGeneration === gen &&
                    useRunInspectorStore.getState().selectedRunId === selectedRunId
                  ) {
                    failStream("events", err);
                  }
                }
              }}
              onLoadMoreTools={async () => {
                if (!selectedRunId || !selected.next_tool_cursor) return;
                if (!beginStream("tools")) return;
                const gen = useRunInspectorStore.getState().refreshGeneration ?? 0;
                try {
                  const page = await adapter.get(selectedRunId, {
                    toolCursor: selected.next_tool_cursor,
                    includeDebug: false,
                  });
                  pageStream(selectedRunId, "tools", page, gen);
                } catch (err) {
                  const statusCode = (err as Error & { status?: number }).status;
                  if (statusCode === 401 || statusCode === 403) {
                    clearUnavailable("denied");
                  } else if (statusCode === 404) {
                    clearUnavailable("not-found");
                  } else if (
                    useRunInspectorStore.getState().refreshGeneration === gen &&
                    useRunInspectorStore.getState().selectedRunId === selectedRunId
                  ) {
                    failStream("tools", err);
                  }
                }
              }}
              onLoadMoreLineage={async () => {
                if (!selectedRunId || !selected.next_lineage_cursor) return;
                if (!beginStream("lineage")) return;
                const gen = useRunInspectorStore.getState().refreshGeneration ?? 0;
                try {
                  const page = await adapter.get(selectedRunId, {
                    lineageCursor: selected.next_lineage_cursor,
                    includeDebug: false,
                  });
                  pageStream(selectedRunId, "lineage", page, gen);
                } catch (err) {
                  const statusCode = (err as Error & { status?: number }).status;
                  if (statusCode === 401 || statusCode === 403) {
                    clearUnavailable("denied");
                  } else if (statusCode === 404) {
                    clearUnavailable("not-found");
                  } else if (
                    useRunInspectorStore.getState().refreshGeneration === gen &&
                    useRunInspectorStore.getState().selectedRunId === selectedRunId
                  ) {
                    failStream("lineage", err);
                  }
                }
              }}
              onLoadMoreDebug={async () => {
                if (!selectedRunId || !selected.next_debug_cursor) return;
                if (!beginStream("debug")) return;
                const gen = useRunInspectorStore.getState().refreshGeneration ?? 0;
                const debugGen = useRunInspectorStore.getState().debugGeneration ?? 0;
                debugAbort.current?.abort();
                const controller = new AbortController();
                debugAbort.current = controller;
                try {
                  const page = await adapter.get(selectedRunId, {
                    debugCursor: selected.next_debug_cursor,
                    includeDebug: true,
                    signal: controller.signal,
                  });
                  if (controller.signal.aborted) return;
                  pageStream(selectedRunId, "debug", page, gen, debugGen);
                } catch (err) {
                  if (controller.signal.aborted) return;
                  const statusCode = (err as Error & { status?: number }).status;
                  if (statusCode === 401 || statusCode === 403) {
                    clearUnavailable("denied");
                  } else if (statusCode === 404) {
                    clearUnavailable("not-found");
                  } else if (
                    useRunInspectorStore.getState().refreshGeneration === gen &&
                    useRunInspectorStore.getState().debugGeneration === debugGen &&
                    useRunInspectorStore.getState().selectedRunId === selectedRunId
                  ) {
                    failStream("debug", err);
                  }
                }
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
