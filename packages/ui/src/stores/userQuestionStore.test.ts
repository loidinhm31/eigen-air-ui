import { afterEach, describe, expect, it } from "vitest";
import type { UserQuestionSnapshot, UserQuestionUpdatedEvent } from "@nonclaw-ui/shared/types";
import {
  pendingQuestionSnapshot,
  reconcileUserQuestionEvent,
  useUserQuestionStore,
} from "./userQuestionStore.js";

afterEach(() => useUserQuestionStore.getState().clearAll());

function snapshot(overrides: Partial<UserQuestionSnapshot> = {}): UserQuestionSnapshot {
  return {
    schema_version: "user_question.v1",
    question_id: "question-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    run_id: "run-1",
    turn_index: 1,
    state: "pending",
    revision: 1,
    created_at_ms: 1,
    expires_at_ms: 2,
    terminal_at_ms: null,
    redaction: "metadata_only",
    request: { kind: "short_text", prompt: "What should the note say?" },
    mutation_token: "a".repeat(32),
    ...overrides,
  };
}

function begin(sessionId = "session-1", daemonUrl = "http://daemon") {
  return useUserQuestionStore.getState().beginGeneration({ daemonUrl, sessionId });
}

describe("userQuestionStore", () => {
  it("isolates identity, session, and generation boundaries", () => {
    const generation = begin();
    expect(useUserQuestionStore.getState().replaceSnapshot(generation, snapshot())).toBe(true);
    expect(pendingQuestionSnapshot(useUserQuestionStore.getState())?.question_id).toBe(
      "question-1"
    );
    const next = begin("session-2");
    expect(useUserQuestionStore.getState().replaceSnapshot(generation, snapshot())).toBe(false);
    expect(
      useUserQuestionStore.getState().replaceSnapshot(next, snapshot({ session_id: "session-2" }))
    ).toBe(true);
    expect(pendingQuestionSnapshot(useUserQuestionStore.getState())?.session_id).toBe("session-2");
  });

  it("uses authoritative replacement and rejects backward revisions", () => {
    const generation = begin();
    useUserQuestionStore.getState().replaceSnapshot(generation, snapshot({ revision: 3 }));
    expect(
      useUserQuestionStore.getState().replaceSnapshot(generation, snapshot({ revision: 2 }))
    ).toBe(false);
    expect(useUserQuestionStore.getState().snapshots["question-1"]?.revision).toBe(3);
    expect(useUserQuestionStore.getState().status).toBe("reconciling");
  });

  it("treats duplicate, stale, backward, gap, reorder, and unsequenced hints as refetches", () => {
    const event: UserQuestionUpdatedEvent = {
      type: "event",
      version: "v1",
      event: "user_question.updated",
      payload: { question_id: "question-1", state: "pending", revision: 1 },
    };
    for (const variant of [event, { ...event, event_seq: 1 }, { ...event, event_seq: 99 }]) {
      expect(reconcileUserQuestionEvent(undefined, variant)).toBe("refetch");
    }
  });

  it("fences racey mutation state and clears terminal secrets", () => {
    const generation = begin();
    const store = useUserQuestionStore.getState();
    store.replaceSnapshot(generation, snapshot());
    expect(store.beginMutation(generation, "question-1")).toBe(true);
    expect(useUserQuestionStore.getState().beginMutation(generation, "question-1")).toBe(false);
    useUserQuestionStore.getState().finishMutation(generation);
    useUserQuestionStore
      .getState()
      .replaceSnapshot(
        generation,
        snapshot({ state: "resolved", revision: 2, request: undefined, mutation_token: undefined })
      );
    const state = useUserQuestionStore.getState();
    expect(state.snapshots["question-1"]).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("mutation_token");
    expect(JSON.stringify(state)).not.toContain("What should the note say?");
  });

  it("keeps question state memory-only and clears on explicit invalidation", () => {
    const generation = begin();
    useUserQuestionStore.getState().replaceSnapshot(generation, snapshot());
    if (typeof localStorage !== "undefined") {
      expect(Object.keys(localStorage)).toHaveLength(0);
    }
    useUserQuestionStore.getState().clearAll("idle");
    expect(useUserQuestionStore.getState().snapshots).toEqual({});
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBeUndefined();
  });

  it("latches an accepted mutation across a stale pending snapshot until terminal cleanup", () => {
    const generation = begin();
    const store = useUserQuestionStore.getState();
    store.replaceSnapshot(generation, snapshot());
    store.latchAccepted(generation, "question-1");
    store.finishMutation(generation, "ready");

    expect(store.isAccepted("question-1")).toBe(true);
    expect(useUserQuestionStore.getState().beginMutation(generation, "question-1")).toBe(false);
    expect(
      useUserQuestionStore.getState().replaceSnapshot(generation, snapshot({ revision: 2 }))
    ).toBe(true);
    expect(useUserQuestionStore.getState().isAccepted("question-1")).toBe(true);

    useUserQuestionStore
      .getState()
      .replaceSnapshot(
        generation,
        snapshot({ state: "resolved", revision: 3, request: undefined, mutation_token: undefined })
      );
    expect(useUserQuestionStore.getState().isAccepted("question-1")).toBe(false);
  });
});
