import { create } from "zustand";
import type {
  ToolApprovalSnapshot,
  ToolApprovalState,
  ToolApprovalUpdatedEvent,
} from "@nonclaw-ui/shared/types";

export type ToolApprovalSyncStatus =
  | "idle"
  | "loading"
  | "ready"
  | "reconciling"
  | "submitting"
  | "offline"
  | "failed";

export interface ToolApprovalContext {
  daemonUrl: string;
  sessionId: string;
  runId: string;
  identityKey?: string;
  accessRevision?: number;
}

export interface ToolApprovalStoreState {
  generation: number;
  context?: ToolApprovalContext;
  snapshots: Record<string, ToolApprovalSnapshot>;
  acceptedApprovalIds: Record<string, true>;
  disabledApprovalIds: Record<string, true>;
  status: ToolApprovalSyncStatus;
  error?: string;
  mutationApprovalId?: string;
  composerBlockedSessionId?: string;
  lastEventRevision: Record<string, number>;

  beginGeneration(context: ToolApprovalContext): number;
  beginRefresh(generation: number): void;
  replaceSnapshots(generation: number, snapshots: ToolApprovalSnapshot[]): boolean;
  replaceSnapshot(generation: number, snapshot: ToolApprovalSnapshot): boolean;
  markReconciling(generation: number): void;
  markOffline(generation: number): void;
  markReady(generation: number): void;
  setError(generation: number, message: string): void;
  markFailed(generation: number, message?: string): void;
  beginMutation(generation: number, approvalId: string): boolean;
  latchAccepted(generation: number, approvalId: string): void;
  isAccepted(approvalId: string): boolean;
  finishMutation(generation: number, status?: ToolApprovalSyncStatus): void;
  recordApprovalHint(generation: number, event?: ToolApprovalUpdatedEvent): void;
  disableApproval(generation: number, approvalId: string, message?: string): void;
  clearApproval(generation: number, approvalId: string): void;
  clearAll(reason?: ToolApprovalSyncStatus): void;
}

export function isApprovalActiveState(state: ToolApprovalState): boolean {
  return state === "pending";
}

function composerSession(
  context: ToolApprovalContext | undefined,
  snapshots: Record<string, ToolApprovalSnapshot>,
  acceptedApprovalIds: Record<string, true> = {}
): string | undefined {
  return context &&
    Object.values(snapshots).some(
      (snapshot) =>
        snapshot.session_id === context.sessionId &&
        (!context.runId || snapshot.run_id === context.runId) &&
        snapshot.state === "pending" &&
        acceptedApprovalIds[snapshot.approval_id] !== true
    )
    ? context.sessionId
    : undefined;
}

export const useToolApprovalStore = create<ToolApprovalStoreState>((set, get) => ({
  generation: 0,
  snapshots: {},
  acceptedApprovalIds: {},
  disabledApprovalIds: {},
  status: "idle",
  lastEventRevision: {},

  beginGeneration: (context) => {
    const generation = get().generation + 1;
    set({
      generation,
      context,
      snapshots: {},
      acceptedApprovalIds: {},
      disabledApprovalIds: {},
      status: "loading",
      error: undefined,
      mutationApprovalId: undefined,
      composerBlockedSessionId: undefined,
      lastEventRevision: {},
    });
    return generation;
  },

  beginRefresh: (generation) => {
    if (generation !== get().generation) return;
    set({ status: "loading", error: undefined });
  },

  replaceSnapshots: (generation, snapshots) => {
    const state = get();
    if (generation !== state.generation) return false;

    const scoped = snapshots.filter(
      (snapshot) =>
        snapshot.session_id === state.context?.sessionId &&
        (!state.context?.runId || snapshot.run_id === state.context?.runId) &&
        snapshot.state === "pending" &&
        state.acceptedApprovalIds[snapshot.approval_id] !== true
    );

    const next: Record<string, ToolApprovalSnapshot> = {};
    for (const snapshot of scoped) {
      next[snapshot.approval_id] = snapshot;
    }

    const acceptedApprovalIds = Object.fromEntries(
      Object.keys(state.acceptedApprovalIds).map((id) => [id, true as const])
    );

    set({
      snapshots: next,
      acceptedApprovalIds,
      composerBlockedSessionId: composerSession(state.context, next, acceptedApprovalIds),
      error: undefined,
    });
    return true;
  },

  replaceSnapshot: (generation, snapshot) => {
    const state = get();
    if (
      generation !== state.generation ||
      snapshot.session_id !== state.context?.sessionId
    ) {
      return false;
    }

    // Hardened: adopt snapshot run_id on session match to avoid dropped approvals
    const context =
      state.context && (!state.context.runId || state.context.runId !== snapshot.run_id)
        ? { ...state.context, runId: snapshot.run_id }
        : state.context;
    if (snapshot.state !== "pending") {
      const next = { ...state.snapshots };
      delete next[snapshot.approval_id];
      set({
        snapshots: next,
        mutationApprovalId:
          state.mutationApprovalId === snapshot.approval_id ? undefined : state.mutationApprovalId,
        composerBlockedSessionId: composerSession(context, next, state.acceptedApprovalIds),
      });
      return true;
    }

    // Authoritative replacement filters an accepted ID out of stale pending results
    if (state.acceptedApprovalIds[snapshot.approval_id] === true) {
      return true;
    }

    const existing = state.snapshots[snapshot.approval_id];
    if (existing && snapshot.revision < existing.revision) {
      set({ status: "reconciling" });
      return false;
    }

    const next = { ...state.snapshots, [snapshot.approval_id]: snapshot };
    set({
      snapshots: next,
      context,
      composerBlockedSessionId: composerSession(context, next, state.acceptedApprovalIds),
      error: undefined,
    });
    return true;
  },

  markReconciling: (generation) => {
    if (generation === get().generation) set({ status: "reconciling" });
  },

  markOffline: (generation) => {
    if (generation === get().generation) set({ status: "offline" });
  },

  markReady: (generation) => {
    if (generation === get().generation) set({ status: "ready", error: undefined });
  },

  setError: (generation, message) => {
    if (generation === get().generation) set({ error: message });
  },

  markFailed: (generation, message = "Approval state unavailable") => {
    if (generation === get().generation) set({ status: "failed", error: message });
  },

  beginMutation: (generation, approvalId) => {
    const state = get();
    if (
      generation !== state.generation ||
      state.mutationApprovalId !== undefined ||
      state.acceptedApprovalIds[approvalId] === true ||
      state.disabledApprovalIds[approvalId] === true ||
      state.snapshots[approvalId]?.state !== "pending"
    ) {
      return false;
    }
    set({ status: "submitting", mutationApprovalId: approvalId, error: undefined });
    return true;
  },

  latchAccepted: (generation, approvalId) => {
    if (generation !== get().generation) return;
    const state = get();
    const acceptedApprovalIds = { ...state.acceptedApprovalIds, [approvalId]: true as const };
    set({
      acceptedApprovalIds,
      composerBlockedSessionId: composerSession(state.context, state.snapshots, acceptedApprovalIds),
    });
  },

  isAccepted: (approvalId) => get().acceptedApprovalIds[approvalId] === true,

  finishMutation: (generation, status = "reconciling") => {
    if (generation !== get().generation) return;
    set({ mutationApprovalId: undefined, status });
  },

  recordApprovalHint: (generation, event) => {
    const state = get();
    if (generation !== state.generation) return;
    if (!event) {
      set({ status: "reconciling" });
      return;
    }
    const nextRevisions = { ...state.lastEventRevision };
    const previous = nextRevisions[event.payload.approval_id];
    nextRevisions[event.payload.approval_id] = Math.max(previous ?? 0, event.payload.revision);
    set({ lastEventRevision: nextRevisions, status: "reconciling" });
  },

  disableApproval: (generation, approvalId, message) => {
    const state = get();
    if (generation !== state.generation) return;
    set({
      disabledApprovalIds: { ...state.disabledApprovalIds, [approvalId]: true },
      ...(message ? { error: message } : {}),
      status: "ready",
    });
  },

  clearApproval: (generation, approvalId) => {
    const state = get();
    if (generation !== state.generation) return;
    const snapshots = { ...state.snapshots };
    delete snapshots[approvalId];
    set({
      snapshots,
      mutationApprovalId:
        state.mutationApprovalId === approvalId ? undefined : state.mutationApprovalId,
      composerBlockedSessionId: composerSession(state.context, snapshots, state.acceptedApprovalIds),
      status: "ready",
    });
  },

  clearAll: (reason = "idle") =>
    set({
      generation: get().generation + 1,
      context: undefined,
      snapshots: {},
      acceptedApprovalIds: {},
      disabledApprovalIds: {},
      status: reason,
      error: undefined,
      mutationApprovalId: undefined,
      composerBlockedSessionId: undefined,
      lastEventRevision: {},
    }),
}));

export function pendingApprovalSnapshot(
  state: Pick<ToolApprovalStoreState, "snapshots" | "context" | "acceptedApprovalIds">
): ToolApprovalSnapshot | undefined {
  const context = state.context;
  if (!context) return undefined;
  return Object.values(state.snapshots).find(
    (snapshot) =>
      snapshot.session_id === context.sessionId &&
      (!context.runId || snapshot.run_id === context.runId) &&
      snapshot.state === "pending" &&
      state.acceptedApprovalIds[snapshot.approval_id] !== true
  );
}
