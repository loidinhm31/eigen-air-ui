import { create } from "zustand";
import type { RunEventDto, RunSnapshotDto } from "@nonclaw-ui/shared/types";

export type RunInspectorStatus =
  | "idle"
  | "loading"
  | "live"
  | "reconciling"
  | "denied"
  | "not-found"
  | "deleted"
  | "failed";

export interface RunInspectorState {
  snapshots: Record<string, RunSnapshotDto>;
  pending: Record<string, RunEventDto[]>;
  status: RunInspectorStatus;
  selectedRunId?: string;
  debugExpiresAtMs?: number;
  error?: string;
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
  if (!snapshot.debug_excerpts) return snapshot;
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
  };
}

export function installSnapshot(
  state: RunInspectorState,
  snapshot: RunSnapshotDto
): RunInspectorState {
  const runId = snapshot.run.run_id;
  const pending = state.pending[runId] ?? [];
  const snapshots = { ...state.snapshots, [runId]: snapshot };
  let next: RunInspectorState = {
    ...state,
    snapshots,
    pending: { ...state.pending, [runId]: [] },
    status: "live",
    error: undefined,
    debugExpiresAtMs: earliestDebugExpiry(snapshots),
  };
  for (const event of [...pending].sort((a, b) => a.event_seq - b.event_seq)) {
    next = applyRunEvent(next, runId, event);
  }
  return next;
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
  begin(): void;
  snapshot(snapshot: RunSnapshotDto): void;
  event(runId: string, event?: RunEventDto): void;
  fail(error: unknown): void;
  clearDebug(runId: string): void;
  clear(reason?: RunInspectorStatus): void;
  expire(now?: number): void;
}

export const useRunInspectorStore = create<RunInspectorState & RunInspectorActions>((set) => ({
  snapshots: {},
  pending: {},
  status: "idle",
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
      };
    }),
  begin: () => set({ status: "loading", error: undefined }),
  snapshot: (snapshot) => set((state) => installSnapshot(state, snapshot)),
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
    set({
      snapshots: {},
      pending: {},
      status,
      selectedRunId: undefined,
      debugExpiresAtMs: undefined,
      error: undefined,
    }),
  expire: (now = Date.now()) =>
    set((state) => {
      if (state.debugExpiresAtMs === undefined || state.debugExpiresAtMs > now) return state;
      const snapshots = Object.fromEntries(
        Object.entries(state.snapshots).map(([id, snapshot]) => [
          id,
          {
            ...snapshot,
            run: {
              ...snapshot.run,
              redaction: {
                ...snapshot.run.redaction,
                metadata_only: true,
                debug_available: false,
                unavailable_reason: "expired" as const,
              },
            },
            debug_excerpts: undefined,
          },
        ])
      );
      return { snapshots, debugExpiresAtMs: undefined };
    }),
}));
