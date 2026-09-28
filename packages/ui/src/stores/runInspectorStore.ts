import { create } from "zustand";
import type { RunEventDto, RunSnapshotDto } from "@eigen-air-ui/shared/types";

export type RunInspectorStatus =
  | "idle"
  | "loading"
  | "live"
  | "reconciling"
  | "denied"
  | "not-found"
  | "deleted"
  | "failed";

export type RunStreamKind = "events" | "tools" | "lineage" | "debug";

export interface StreamState {
  loading: boolean;
  error?: string;
}

export type StreamStateMap = Record<RunStreamKind, StreamState>;

export const INITIAL_STREAMS: StreamStateMap = {
  events: { loading: false },
  tools: { loading: false },
  lineage: { loading: false },
  debug: { loading: false },
};

export interface RunInspectorState {
  snapshots: Record<string, RunSnapshotDto>;
  pending: Record<string, RunEventDto[]>;
  status: RunInspectorStatus;
  selectedRunId?: string;
  debugExpiresAtMs?: number;
  error?: string;
  operation?: {
    kind: "export" | "delete";
    runId: string;
    status: "pending" | "success" | "failed";
    error?: string;
  };
  refreshGeneration?: number;
  streams?: StreamStateMap;
}

function earliestDebugExpiry(snapshots: Record<string, RunSnapshotDto>): number | undefined {
  let earliest: number | undefined;
  for (const snapshot of Object.values(snapshots)) {
    for (const excerpt of snapshot.debug_excerpts ?? []) {
      earliest =
        earliest === undefined ? excerpt.expires_at_ms : Math.min(earliest, excerpt.expires_at_ms);
    }
  }
  return earliest;
}

function clearSnapshotDebug(snapshot: RunSnapshotDto): RunSnapshotDto {
  if (!snapshot.debug_excerpts && !snapshot.next_debug_cursor) return snapshot;
  return {
    ...snapshot,
    run: {
      ...snapshot.run,
      redaction: {
        ...snapshot.run.redaction,
        metadata_only: true,
        debug_available: false,
      },
    },
    debug_excerpts: undefined,
    next_debug_cursor: null,
  };
}

function expireSnapshotDebug(snapshot: RunSnapshotDto): RunSnapshotDto {
  const cleared = clearSnapshotDebug(snapshot);
  return {
    ...cleared,
    run: {
      ...cleared.run,
      redaction: {
        ...cleared.run.redaction,
        metadata_only: true,
        debug_available: false,
        unavailable_reason: "expired",
      },
    },
    next_debug_cursor: null,
  };
}

function withoutExpiredDebug(snapshot: RunSnapshotDto, now: number): RunSnapshotDto {
  return (snapshot.debug_excerpts ?? []).some((excerpt) => excerpt.expires_at_ms <= now)
    ? expireSnapshotDebug(snapshot)
    : snapshot;
}

export function installSnapshot(
  state: RunInspectorState,
  snapshot: RunSnapshotDto,
  generation?: number
): RunInspectorState {
  const currentGen = state.refreshGeneration ?? 0;
  if (generation !== undefined && generation !== currentGen) {
    return state;
  }
  const runId = snapshot.run.run_id;
  const pending = state.pending[runId] ?? [];
  const snapshots = { ...state.snapshots, [runId]: withoutExpiredDebug(snapshot, Date.now()) };
  let next: RunInspectorState = {
    ...state,
    snapshots,
    pending: { ...state.pending, [runId]: [] },
    status: "live",
    error: undefined,
    debugExpiresAtMs: earliestDebugExpiry(snapshots),
    streams: { ...INITIAL_STREAMS },
  };
  for (const event of [...pending].sort((a, b) => a.event_seq - b.event_seq)) {
    next = applyRunEvent(next, runId, event);
  }
  return next;
}

export function mergeStreamPage(
  state: RunInspectorState,
  runId: string,
  stream: RunStreamKind,
  page: RunSnapshotDto,
  generation?: number
): RunInspectorState {
  if (state.selectedRunId && state.selectedRunId !== runId) {
    return state;
  }
  if (!state.snapshots[runId]) {
    return state;
  }
  const currentGen = state.refreshGeneration ?? 0;
  if (generation !== undefined && generation !== currentGen) {
    return state;
  }

  const current = state.snapshots[runId];
  let updatedSnapshot: RunSnapshotDto;

  switch (stream) {
    case "events": {
      const existingIds = new Set(current.events.map((e) => e.event_id).filter(Boolean));
      const newEvents: RunEventDto[] = [...current.events];
      for (const ev of page.events) {
        if (!ev.event_id || !existingIds.has(ev.event_id)) {
          if (ev.event_id) existingIds.add(ev.event_id);
          newEvents.push(ev);
        }
      }
      newEvents.sort((a, b) => a.event_seq - b.event_seq);
      updatedSnapshot = {
        ...current,
        events: newEvents,
        next_event_cursor: page.next_event_cursor ?? null,
      };
      break;
    }
    case "tools": {
      const existingKeys = new Set(
        current.tool_calls.map((t) => `${t.tool_call_id}:${t.ordinal}`)
      );
      const newTools = [...current.tool_calls];
      for (const tool of page.tool_calls) {
        const key = `${tool.tool_call_id}:${tool.ordinal}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          newTools.push(tool);
        }
      }
      newTools.sort((a, b) => a.ordinal - b.ordinal);
      updatedSnapshot = {
        ...current,
        tool_calls: newTools,
        next_tool_cursor: page.next_tool_cursor ?? null,
      };
      break;
    }
    case "lineage": {
      const existingSeqs = new Set(current.memory_lineage.map((m) => m.lineage_seq));
      const newLineage = [...current.memory_lineage];
      for (const item of page.memory_lineage) {
        if (!existingSeqs.has(item.lineage_seq)) {
          existingSeqs.add(item.lineage_seq);
          newLineage.push(item);
        }
      }
      newLineage.sort((a, b) => a.lineage_seq - b.lineage_seq);
      updatedSnapshot = {
        ...current,
        memory_lineage: newLineage,
        next_lineage_cursor: page.next_lineage_cursor ?? null,
      };
      break;
    }
    case "debug": {
      const existingExcerpts = current.debug_excerpts ?? [];
      const pageExcerpts = page.debug_excerpts ?? [];
      const existingSeqs = new Set(existingExcerpts.map((d) => d.excerpt_seq));
      const newExcerpts = [...existingExcerpts];
      for (const item of pageExcerpts) {
        if (!existingSeqs.has(item.excerpt_seq)) {
          existingSeqs.add(item.excerpt_seq);
          newExcerpts.push(item);
        }
      }
      newExcerpts.sort((a, b) => a.excerpt_seq - b.excerpt_seq);
      updatedSnapshot = withoutExpiredDebug(
        {
          ...current,
          debug_excerpts: newExcerpts,
          next_debug_cursor: page.next_debug_cursor ?? null,
        },
        Date.now()
      );
      break;
    }
  }

  const snapshots = { ...state.snapshots, [runId]: updatedSnapshot };
  const currentStreams = state.streams ?? INITIAL_STREAMS;
  return {
    ...state,
    snapshots,
    debugExpiresAtMs: earliestDebugExpiry(snapshots),
    streams: {
      ...currentStreams,
      [stream]: { loading: false, error: undefined },
    },
  };
}

export function applyRunEvent(
  state: RunInspectorState,
  runId: string,
  event?: RunEventDto
): RunInspectorState {
  if (!event) return { ...state, status: "reconciling" };
  const snapshot = state.snapshots[runId];
  if (!snapshot)
    return {
      ...state,
      pending: { ...state.pending, [runId]: [...(state.pending[runId] ?? []), event] },
    };
  if (
    !event.event_id ||
    event.event_seq <= snapshot.run.snapshot_seq ||
    snapshot.events.some((entry) => entry.event_id === event.event_id)
  )
    return state;
  if (event.event_seq !== snapshot.run.snapshot_seq + 1) return { ...state, status: "reconciling" };
  return {
    ...state,
    snapshots: {
      ...state.snapshots,
      [runId]: {
        ...snapshot,
        run: {
          ...snapshot.run,
          snapshot_seq: event.event_seq,
          updated_at_ms: event.occurred_at_ms,
          ...(event.lifecycle_status ? { lifecycle_status: event.lifecycle_status } : {}),
        },
        events: [...snapshot.events, event],
      },
    },
  };
}

interface RunInspectorActions {
  select(runId?: string): void;
  begin(): number;
  snapshot(snapshot: RunSnapshotDto, generation?: number): void;
  event(runId: string, event?: RunEventDto): void;
  fail(error: unknown): void;
  clearDebug(runId: string): void;
  clear(reason?: RunInspectorStatus): void;
  expire(now?: number): void;
  beginOperation(kind: "export" | "delete", runId: string): void;
  completeOperation(kind: "export" | "delete", runId: string): void;
  failOperation(kind: "export" | "delete", runId: string, error: unknown): void;
  evict(runId: string): void;
  beginStream(stream: RunStreamKind): boolean;
  pageStream(runId: string, stream: RunStreamKind, page: RunSnapshotDto, generation?: number): void;
  failStream(stream: RunStreamKind, error: unknown): void;
}

export const useRunInspectorStore = create<RunInspectorState & RunInspectorActions>((set) => ({
  snapshots: {},
  pending: {},
  status: "idle",
  refreshGeneration: 0,
  streams: INITIAL_STREAMS,
  select: (selectedRunId) =>
    set((state) => {
      if (selectedRunId === state.selectedRunId) return { selectedRunId };
      const snapshots = Object.fromEntries(
        Object.entries(state.snapshots).map(([id, value]) => [id, clearSnapshotDebug(value)])
      );
      return {
        selectedRunId,
        snapshots,
        debugExpiresAtMs: earliestDebugExpiry(snapshots),
        refreshGeneration: (state.refreshGeneration ?? 0) + 1,
        streams: { ...INITIAL_STREAMS },
      };
    }),
  begin: () => {
    let nextGen = 0;
    set((state) => {
      nextGen = (state.refreshGeneration ?? 0) + 1;
      return {
        status: "loading",
        error: undefined,
        refreshGeneration: nextGen,
        streams: { ...INITIAL_STREAMS },
      };
    });
    return nextGen;
  },
  snapshot: (snapshot, generation) => set((state) => installSnapshot(state, snapshot, generation)),
  event: (runId, event) => set((state) => applyRunEvent(state, runId, event)),
  fail: (error) =>
    set({ status: "failed", error: error instanceof Error ? error.message : "Run request failed" }),
  clearDebug: (runId) =>
    set((state) => {
      const snapshot = state.snapshots[runId];
      if (!snapshot) return state;
      const snapshots = { ...state.snapshots, [runId]: clearSnapshotDebug(snapshot) };
      return { snapshots, debugExpiresAtMs: earliestDebugExpiry(snapshots) };
    }),
  // Drop every reference, not only the active selection, on security/lifecycle boundaries.
  clear: (status = "idle") =>
    set((state) => ({
      snapshots: {},
      pending: {},
      status,
      selectedRunId: undefined,
      debugExpiresAtMs: undefined,
      error: undefined,
      operation: undefined,
      refreshGeneration: (state.refreshGeneration ?? 0) + 1,
      streams: { ...INITIAL_STREAMS },
    })),
  beginStream: (stream) => {
    let started = false;
    set((state) => {
      const currentStreams = state.streams ?? INITIAL_STREAMS;
      if (currentStreams[stream]?.loading) {
        return state;
      }
      started = true;
      return {
        streams: {
          ...currentStreams,
          [stream]: { loading: true, error: undefined },
        },
      };
    });
    return started;
  },
  pageStream: (runId, stream, page, generation) =>
    set((state) => mergeStreamPage(state, runId, stream, page, generation)),
  failStream: (stream, error) =>
    set((state) => {
      const currentStreams = state.streams ?? INITIAL_STREAMS;
      return {
        streams: {
          ...currentStreams,
          [stream]: {
            loading: false,
            error: error instanceof Error ? error.message : "Page load failed",
          },
        },
      };
    }),
  expire: (now = Date.now()) =>
    set((state) => {
      if (state.debugExpiresAtMs === undefined || state.debugExpiresAtMs > now) return state;
      const expiredRunIds = new Set<string>();
      const snapshots = Object.fromEntries(
        Object.entries(state.snapshots).map(([id, snapshot]) => {
          const expired = (snapshot.debug_excerpts ?? []).some(
            (excerpt) => excerpt.expires_at_ms <= now
          );
          if (expired) expiredRunIds.add(id);
          return [id, expired ? expireSnapshotDebug(snapshot) : snapshot];
        })
      );
      // Only discard delayed events for the run whose sensitive debug data
      // expired. Unrelated runs may still be reconciling and must retain their
      // correlation queue.
      const pending = Object.fromEntries(
        Object.entries(state.pending).filter(([runId]) => !expiredRunIds.has(runId))
      );
      return {
        snapshots,
        pending,
        debugExpiresAtMs: earliestDebugExpiry(snapshots),
      };
    }),
  beginOperation: (kind, runId) =>
    set({ operation: { kind, runId, status: "pending" }, error: undefined }),
  completeOperation: (kind, runId) =>
    set({ operation: { kind, runId, status: "success" }, error: undefined }),
  failOperation: (kind, runId, error) =>
    set({
      operation: {
        kind,
        runId,
        status: "failed",
        error: error instanceof Error ? error.message : `Run ${kind} failed`,
      },
    }),
  evict: (runId) =>
    set((state) => {
      const snapshots = { ...state.snapshots };
      const pending = { ...state.pending };
      delete snapshots[runId];
      delete pending[runId];
      return {
        snapshots,
        pending,
        selectedRunId: state.selectedRunId === runId ? undefined : state.selectedRunId,
        status: "deleted",
        debugExpiresAtMs: earliestDebugExpiry(snapshots),
      };
    }),
}));
