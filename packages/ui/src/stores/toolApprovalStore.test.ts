import { afterEach, describe, expect, it } from "vitest";
import type { ToolApprovalSnapshot } from "@nonclaw-ui/shared/types";
import {
  pendingApprovalSnapshot,
  useToolApprovalStore,
} from "./toolApprovalStore.js";

afterEach(() => useToolApprovalStore.getState().clearAll());

function snapshot(overrides: Partial<ToolApprovalSnapshot> = {}): ToolApprovalSnapshot {
  return {
    approval_id: "app-1",
    schema_version: "tool_approval.v1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    run_id: "run-1",
    tool_call_id: "call-1",
    ordinal: 1,
    tool_name: "shell",
    operation: "execute",
    risk: "high",
    state: "pending",
    safe_summary: {
      program: "ls",
      args_count: 1,
      working_dir: "workspace_root",
    },
    binding_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    revision: 1,
    created_at_ms: 1000,
    expires_at_ms: 2000,
    terminal_at_ms: null,
    terminal_code: null,
    decision_by_credential_id: null,
    redaction: "metadata_only",
    ...overrides,
  };
}

function begin(sessionId = "session-1", runId = "run-1", daemonUrl = "http://daemon") {
  return useToolApprovalStore.getState().beginGeneration({ daemonUrl, sessionId, runId });
}

describe("toolApprovalStore", () => {
  it("isolates generation, session, and run boundaries", () => {
    const generation = begin();
    expect(useToolApprovalStore.getState().replaceSnapshot(generation, snapshot())).toBe(true);
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())?.approval_id).toBe("app-1");
    expect(useToolApprovalStore.getState().composerBlockedSessionId).toBe("session-1");

    // Old generation cannot replace
    const next = begin("session-2", "run-2");
    expect(useToolApprovalStore.getState().replaceSnapshot(generation, snapshot())).toBe(false);

    // Mismatched session or run cannot replace in new generation
    expect(useToolApprovalStore.getState().replaceSnapshot(next, snapshot())).toBe(false);

    // Matching session and run succeeds
    expect(
      useToolApprovalStore
        .getState()
        .replaceSnapshot(next, snapshot({ session_id: "session-2", run_id: "run-2" }))
    ).toBe(true);
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())?.session_id).toBe("session-2");
    expect(useToolApprovalStore.getState().composerBlockedSessionId).toBe("session-2");
  });

  it("uses authoritative replacement and flags stale/backward revisions as reconciling", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot({ revision: 3 }));
    expect(
      useToolApprovalStore.getState().replaceSnapshot(generation, snapshot({ revision: 2 }))
    ).toBe(false);
    expect(useToolApprovalStore.getState().snapshots["app-1"]?.revision).toBe(3);
    expect(useToolApprovalStore.getState().status).toBe("reconciling");
  });

  it("fences concurrent mutations and enforces single in-flight mutation", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot());
    expect(useToolApprovalStore.getState().beginMutation(generation, "app-1")).toBe(true);
    expect(useToolApprovalStore.getState().status).toBe("submitting");

    // Second mutation blocked while first is in-flight
    expect(useToolApprovalStore.getState().beginMutation(generation, "app-1")).toBe(false);

    useToolApprovalStore.getState().finishMutation(generation, "ready");
    expect(useToolApprovalStore.getState().status).toBe("ready");
  });

  it("latches accepted mutation across stale pending snapshots", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot());
    useToolApprovalStore.getState().latchAccepted(generation, "app-1");
    useToolApprovalStore.getState().finishMutation(generation, "ready");

    expect(useToolApprovalStore.getState().isAccepted("app-1")).toBe(true);
    // Cannot mutate once accepted
    expect(useToolApprovalStore.getState().beginMutation(generation, "app-1")).toBe(false);

    // Pending snapshot is filtered out once accepted
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())).toBeUndefined();
    expect(useToolApprovalStore.getState().composerBlockedSessionId).toBeUndefined();

    // Stale replaceSnapshots does not re-open controls
    useToolApprovalStore.getState().replaceSnapshots(generation, [snapshot()]);
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())).toBeUndefined();
  });

  it("removes the card when authoritative state advances past pending", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot());
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())).toBeDefined();

    // Authoritative approved_once
    useToolApprovalStore
      .getState()
      .replaceSnapshot(generation, snapshot({ state: "approved_once", revision: 2 }));
    expect(pendingApprovalSnapshot(useToolApprovalStore.getState())).toBeUndefined();
    expect(useToolApprovalStore.getState().snapshots["app-1"]).toBeUndefined();
    expect(useToolApprovalStore.getState().composerBlockedSessionId).toBeUndefined();
  });

  it("disables controls on disableApproval", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot());
    useToolApprovalStore
      .getState()
      .disableApproval(generation, "app-1", "Approval resolution unavailable for current credentials");

    expect(useToolApprovalStore.getState().disabledApprovalIds["app-1"]).toBe(true);
    expect(useToolApprovalStore.getState().error).toBe(
      "Approval resolution unavailable for current credentials"
    );
    expect(useToolApprovalStore.getState().beginMutation(generation, "app-1")).toBe(false);
  });

  it("keeps state memory-only and clears all on invalidation", () => {
    const generation = begin();
    useToolApprovalStore.getState().replaceSnapshot(generation, snapshot());
    expect(Object.keys(useToolApprovalStore.getState().snapshots)).toHaveLength(1);

    useToolApprovalStore.getState().clearAll("idle");
    const state = useToolApprovalStore.getState();
    expect(state.snapshots).toEqual({});
    expect(state.composerBlockedSessionId).toBeUndefined();
    expect(state.acceptedApprovalIds).toEqual({});
    expect(state.status).toBe("idle");
  });
});
