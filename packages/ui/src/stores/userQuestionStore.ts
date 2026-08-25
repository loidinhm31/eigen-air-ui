import { create } from "zustand";
import type { UserQuestionSnapshot, UserQuestionUpdatedEvent } from "@nonclaw-ui/shared/types";

export type UserQuestionSyncStatus =
  | "idle"
  | "loading"
  | "ready"
  | "reconciling"
  | "submitting"
  | "offline"
  | "failed";

export interface UserQuestionContext {
  daemonUrl: string;
  sessionId: string;
  identityKey?: string;
  accessRevision?: number;
}

export interface UserQuestionStoreState {
  generation: number;
  context?: UserQuestionContext;
  snapshots: Record<string, UserQuestionSnapshot>;
  acceptedQuestionIds: Record<string, true>;
  status: UserQuestionSyncStatus;
  error?: string;
  mutationQuestionId?: string;
  composerBlockedSessionId?: string;
  lastEventSeq?: number;
  lastEventRevision: Record<string, number>;
  beginGeneration(context: UserQuestionContext): number;
  beginRefresh(generation: number): void;
  replaceSnapshots(generation: number, snapshots: UserQuestionSnapshot[]): boolean;
  replaceSnapshot(generation: number, snapshot: UserQuestionSnapshot): boolean;
  markReconciling(generation: number): void;
  markOffline(generation: number): void;
  markReady(generation: number): void;
  setError(generation: number, message: string): void;
  markFailed(generation: number, message?: string): void;
  beginMutation(generation: number, questionId: string): boolean;
  latchAccepted(generation: number, questionId: string): void;
  isAccepted(questionId: string): boolean;
  finishMutation(generation: number, status?: UserQuestionSyncStatus): void;
  recordQuestionHint(generation: number, event?: UserQuestionUpdatedEvent): void;
  clearQuestion(generation: number, questionId: string): void;
  clearAll(reason?: UserQuestionSyncStatus): void;
}

export function isQuestionActiveState(state: UserQuestionSnapshot["state"]): boolean {
  return state === "pending" || state === "answered" || state === "continuing";
}

function withoutSecrets(snapshot: UserQuestionSnapshot): UserQuestionSnapshot {
  const safe = { ...snapshot };
  delete safe.mutation_token;
  if (safe.state !== "pending") {
    delete safe.request;
  }
  return safe;
}

function snapshotMap(snapshots: UserQuestionSnapshot[]): Record<string, UserQuestionSnapshot> {
  return Object.fromEntries(
    snapshots.map((snapshot) => [snapshot.question_id, withoutSecrets(snapshot)])
  );
}

function composerSession(
  context: UserQuestionContext | undefined,
  snapshots: Record<string, UserQuestionSnapshot>
): string | undefined {
  return context &&
    Object.values(snapshots).some(
      (snapshot) =>
        snapshot.session_id === context.sessionId && isQuestionActiveState(snapshot.state)
    )
    ? context.sessionId
    : undefined;
}

export const useUserQuestionStore = create<UserQuestionStoreState>((set, get) => ({
  generation: 0,
  snapshots: {},
  acceptedQuestionIds: {},
  status: "idle",
  lastEventSeq: undefined,
  lastEventRevision: {},
  beginGeneration: (context) => {
    const generation = get().generation + 1;
    set({
      generation,
      context,
      snapshots: {},
      acceptedQuestionIds: {},
      status: "loading",
      error: undefined,
      mutationQuestionId: undefined,
      composerBlockedSessionId: undefined,
      lastEventSeq: undefined,
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
        snapshot.session_id === state.context?.sessionId && isQuestionActiveState(snapshot.state)
    );
    const next = snapshotMap(scoped);
    const acceptedQuestionIds = Object.fromEntries(
      Object.keys(state.acceptedQuestionIds)
        .filter((questionId) => next[questionId] !== undefined)
        .map((questionId) => [questionId, true as const])
    );
    set({
      snapshots: next,
      acceptedQuestionIds,
      composerBlockedSessionId: composerSession(state.context, next),
      error: undefined,
    });
    return true;
  },
  replaceSnapshot: (generation, snapshot) => {
    const state = get();
    if (generation !== state.generation || snapshot.session_id !== state.context?.sessionId) {
      return false;
    }
    if (!isQuestionActiveState(snapshot.state)) {
      const next = { ...state.snapshots };
      delete next[snapshot.question_id];
      set({
        snapshots: next,
        acceptedQuestionIds: Object.fromEntries(
          Object.entries(state.acceptedQuestionIds).filter(
            ([questionId]) => questionId !== snapshot.question_id
          )
        ),
        mutationQuestionId:
          state.mutationQuestionId === snapshot.question_id ? undefined : state.mutationQuestionId,
        composerBlockedSessionId: composerSession(state.context, next),
      });
      return true;
    }
    const existing = state.snapshots[snapshot.question_id];
    if (existing && snapshot.revision < existing.revision) {
      set({ status: "reconciling" });
      return false;
    }
    const next = { ...state.snapshots, [snapshot.question_id]: withoutSecrets(snapshot) };
    set({
      snapshots: next,
      composerBlockedSessionId: composerSession(state.context, next),
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
  markFailed: (generation, message = "Question state unavailable") => {
    if (generation === get().generation) set({ status: "failed", error: message });
  },
  beginMutation: (generation, questionId) => {
    const state = get();
    if (
      generation !== state.generation ||
      state.mutationQuestionId !== undefined ||
      state.acceptedQuestionIds[questionId] === true ||
      state.snapshots[questionId]?.state !== "pending"
    ) {
      return false;
    }
    set({ status: "submitting", mutationQuestionId: questionId, error: undefined });
    return true;
  },
  latchAccepted: (generation, questionId) => {
    if (generation !== get().generation) return;
    set((state) => ({
      acceptedQuestionIds: { ...state.acceptedQuestionIds, [questionId]: true },
    }));
  },
  isAccepted: (questionId) => get().acceptedQuestionIds[questionId] === true,
  finishMutation: (generation, status = "reconciling") => {
    if (generation !== get().generation) return;
    set({ mutationQuestionId: undefined, status });
  },
  recordQuestionHint: (generation, event) => {
    const state = get();
    if (generation !== state.generation) return;
    if (!event) {
      set({ status: "reconciling" });
      return;
    }
    const nextRevisions = { ...state.lastEventRevision };
    const previousRevision = nextRevisions[event.payload.question_id];
    nextRevisions[event.payload.question_id] = Math.max(
      previousRevision ?? 0,
      event.payload.revision
    );
    const nextSeq =
      event.event_seq !== undefined
        ? Math.max(state.lastEventSeq ?? 0, event.event_seq)
        : state.lastEventSeq;
    // Hints are never applied locally. Recording the cursor is only for
    // diagnostics and future classification; every variant still refetches.
    set({ lastEventSeq: nextSeq, lastEventRevision: nextRevisions, status: "reconciling" });
  },
  clearQuestion: (generation, questionId) => {
    const state = get();
    if (generation !== state.generation) return;
    const snapshots = { ...state.snapshots };
    delete snapshots[questionId];
    set({
      snapshots,
      acceptedQuestionIds: Object.fromEntries(
        Object.entries(state.acceptedQuestionIds).filter(
          ([acceptedQuestionId]) => acceptedQuestionId !== questionId
        )
      ),
      mutationQuestionId:
        state.mutationQuestionId === questionId ? undefined : state.mutationQuestionId,
      composerBlockedSessionId: composerSession(state.context, snapshots),
    });
  },
  clearAll: (reason = "idle") =>
    set({
      generation: get().generation + 1,
      context: undefined,
      snapshots: {},
      acceptedQuestionIds: {},
      status: reason,
      error: undefined,
      mutationQuestionId: undefined,
      composerBlockedSessionId: undefined,
      lastEventSeq: undefined,
      lastEventRevision: {},
    }),
}));

export function pendingQuestionSnapshot(
  state: Pick<UserQuestionStoreState, "snapshots" | "context">
): UserQuestionSnapshot | undefined {
  return Object.values(state.snapshots).find(
    (snapshot) =>
      snapshot.session_id === state.context?.sessionId &&
      isQuestionActiveState(snapshot.state)
  );
}

/** WS frames are hints only. Any duplicate, stale, gap, reorder, or missing
 * sequence must converge through a fresh REST replacement. */
export function reconcileUserQuestionEvent(
  snapshot: UserQuestionSnapshot | undefined,
  event: UserQuestionUpdatedEvent | undefined
): "refetch" {
  void snapshot;
  void event;
  return "refetch";
}
