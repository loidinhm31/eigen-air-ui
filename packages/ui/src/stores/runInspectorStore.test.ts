import { describe, expect, it, vi } from "vitest";
import type { RunEventDto, RunSnapshotDto, ToolApprovalSnapshot } from "@eigen-air-ui/shared/types";
import {
  applyRunEvent,
  installSnapshot,
  mergeStreamPage,
  useRunInspectorStore,
  type RunInspectorState,
} from "./runInspectorStore.js";

const snapshot = (runId = "run-a", sequence = 1): RunSnapshotDto => ({
  schema_version: 1,
  run: {
    run_id: runId,
    trace_id: `trace-${runId}`,
    session_id: "session-a",
    root_run_id: runId,
    tenant_id: "tenant",
    user_id: "user",
    workspace_id: "workspace",
    agent_id: "agent",
    provider_id: "provider",
    channel: "web",
    lifecycle_status: "running",
    started_at_ms: 1,
    updated_at_ms: 1,
    snapshot_seq: sequence,
    correlation_state: "correlated",
    redaction: { metadata_only: true, debug_requested: false, debug_available: false },
  },
  events: [],
  tool_calls: [],
  memory_lineage: [],
});
const event = (sequence: number, id = `event-${sequence}`): RunEventDto => ({
  event_id: id,
  event_seq: sequence,
  event_kind: "run.delta",
  occurred_at_ms: sequence,
});
const state = (): RunInspectorState => ({ snapshots: {}, pending: {}, status: "idle" });

describe("run inspector reconciliation", () => {
  it("keeps same-session runs separate and installs server snapshots as authority", () => {
    const next = installSnapshot(installSnapshot(state(), snapshot("run-a")), snapshot("run-b"));
    expect(Object.keys(next.snapshots)).toEqual(["run-a", "run-b"]);
  });
  it("dedupes old events and applies only the next contiguous sequence", () => {
    const installed = installSnapshot(state(), snapshot());
    expect(applyRunEvent(installed, "run-a", event(1)).snapshots["run-a"].run.snapshot_seq).toBe(1);
    expect(applyRunEvent(installed, "run-a", event(2)).snapshots["run-a"].run.snapshot_seq).toBe(2);
  });
  it("marks a sequence gap or unsequenced frame for REST reconciliation", () => {
    const installed = installSnapshot(state(), snapshot());
    expect(applyRunEvent(installed, "run-a", event(3)).status).toBe("reconciling");
    expect(applyRunEvent(installed, "run-a").status).toBe("reconciling");
  });
  it("queues events before a snapshot and replays the contiguous future event", () => {
    const queued = applyRunEvent(state(), "run-a", event(2));
    const originalPending = [...queued.pending["run-a"]];
    const resolved = installSnapshot(queued, snapshot("run-a", 1));
    expect(resolved.snapshots["run-a"].run.snapshot_seq).toBe(2);
    expect(queued.pending["run-a"]).toEqual(originalPending);
  });
  it("zeroes sensitive snapshot and queue references for lifecycle clear and expiry", () => {
    const sensitive: RunSnapshotDto = {
      ...snapshot(),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_reasoning",
          plaintext: "secret",
          created_at_ms: 1,
          expires_at_ms: 2,
          plaintext_bytes: 6,
          truncated: false,
          redaction_count: 0,
        },
      ],
    };
    useRunInspectorStore.getState().snapshot(sensitive);
    useRunInspectorStore.getState().expire(2);
    expect(useRunInspectorStore.getState().snapshots["run-a"].debug_excerpts).toBeUndefined();
    expect(useRunInspectorStore.getState().snapshots["run-a"].run.redaction).toMatchObject({
      metadata_only: true,
      debug_available: false,
      unavailable_reason: "expired",
    });
    useRunInspectorStore.getState().clear("denied");
    expect(useRunInspectorStore.getState()).toMatchObject({
      snapshots: {},
      pending: {},
      selectedRunId: undefined,
      status: "denied",
    });
  });
  it("retains the earliest debug timer across metadata-only snapshot installs", () => {
    const expiresAt = Date.now() + 10_000;
    const sensitive = {
      ...snapshot("run-a"),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_response" as const,
          plaintext: "secret",
          created_at_ms: 1,
          expires_at_ms: expiresAt,
          plaintext_bytes: 6,
          truncated: false,
          redaction_count: 0,
        },
      ],
    };
    const installed = installSnapshot(installSnapshot(state(), sensitive), snapshot("run-b"));
    expect(installed.debugExpiresAtMs).toBe(expiresAt);
  });
  it("clears cached debug plaintext when selection changes", () => {
    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot({
      ...snapshot("run-a"),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_response",
          plaintext: "secret",
          created_at_ms: 1,
          expires_at_ms: 10,
          plaintext_bytes: 6,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });
    useRunInspectorStore.getState().select("run-a");
    useRunInspectorStore.getState().select("run-b");
    expect(useRunInspectorStore.getState().snapshots["run-a"].debug_excerpts).toBeUndefined();
    expect(useRunInspectorStore.getState().debugExpiresAtMs).toBeUndefined();
  });
  it("does not retain already-expired plaintext and preserves unrelated pending queues", () => {
    const expired = {
      ...snapshot(),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_response" as const,
          plaintext: "expired-secret",
          created_at_ms: 1,
          expires_at_ms: 1,
          plaintext_bytes: 14,
          truncated: false,
          redaction_count: 0,
        },
      ],
    };
    const installed = installSnapshot(state(), expired);
    expect(installed.snapshots["run-a"].debug_excerpts).toBeUndefined();

    useRunInspectorStore.getState().clear();
    const expiresAt = Date.now() + 10_000;
    useRunInspectorStore.getState().snapshot({
      ...expired,
      debug_excerpts: [{ ...expired.debug_excerpts[0], expires_at_ms: expiresAt }],
    });
    useRunInspectorStore.getState().event("run-b", event(1));
    useRunInspectorStore.getState().expire(expiresAt);
    expect(useRunInspectorStore.getState().pending).toEqual({ "run-b": [event(1)] });
  });

  it("evicts a run only when the caller confirms deletion", () => {
    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(snapshot());
    useRunInspectorStore.getState().beginOperation("delete", "run-a");
    expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeDefined();
    useRunInspectorStore.getState().evict("run-a");
    expect(useRunInspectorStore.getState()).toMatchObject({
      snapshots: {},
      pending: {},
      status: "deleted",
    });
  });

  it("expires only cached debug snapshots at the exact deadline while queues are pending", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const expiresAt = now + 1_000;
    const debug = (runId: string): RunSnapshotDto => ({
      ...snapshot(runId),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_response",
          plaintext: `${runId}-secret`,
          created_at_ms: now,
          expires_at_ms: expiresAt,
          plaintext_bytes: 12,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });
    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(debug("run-a"));
    useRunInspectorStore.getState().snapshot(debug("run-b"));
    useRunInspectorStore.getState().event("run-c", event(1));
    useRunInspectorStore.getState().expire(expiresAt);
    const current = useRunInspectorStore.getState();
    expect(Object.values(current.snapshots).every((item) => item.debug_excerpts === undefined)).toBe(
      true
    );
    expect(current.pending).toEqual({ "run-c": [event(1)] });
    vi.useRealTimers();
  });

  it("merges only the requested stream and preserves other streams and cursors", () => {
    const initial: RunSnapshotDto = {
      ...snapshot("run-1"),
      events: [event(1, "evt-1")],
      tool_calls: [
        {
          tool_call_id: "tool-1",
          ordinal: 0,
          tool_name: "file_read",
          status: "completed",
          started_at_ms: 1,
        },
      ],
      next_event_cursor: "cursor-evt-1",
      next_tool_cursor: "cursor-tool-1",
    };

    const stateWithInitial: RunInspectorState = {
      snapshots: { "run-1": initial },
      pending: {},
      status: "live",
      selectedRunId: "run-1",
      refreshGeneration: 1,
    };

    // Page response returns new events, but also has incidental first-page tools and a reset tool cursor
    const pageResponse: RunSnapshotDto = {
      ...snapshot("run-1"),
      events: [event(2, "evt-2")],
      tool_calls: [
        {
          tool_call_id: "incidental-tool",
          ordinal: 0,
          tool_name: "other",
          status: "completed",
          started_at_ms: 1,
        },
      ],
      next_event_cursor: "cursor-evt-2",
      next_tool_cursor: "reset-tool-cursor",
    };

    const updated = mergeStreamPage(stateWithInitial, "run-1", "events", pageResponse, 1);
    const snap = updated.snapshots["run-1"];

    // Events stream updated
    expect(snap.events).toHaveLength(2);
    expect(snap.events.map((e) => e.event_id)).toEqual(["evt-1", "evt-2"]);
    expect(snap.next_event_cursor).toBe("cursor-evt-2");

    // Tools stream and cursor preserved from initial, incidental page tool data ignored
    expect(snap.tool_calls).toHaveLength(1);
    expect(snap.tool_calls[0].tool_call_id).toBe("tool-1");
    expect(snap.next_tool_cursor).toBe("cursor-tool-1");
  });

  it("deduplicates stream rows by stable identity and maintains server sequence order", () => {
    const initial: RunSnapshotDto = {
      ...snapshot("run-1"),
      events: [event(1, "evt-1"), event(3, "evt-3")],
      tool_calls: [
        { tool_call_id: "t-1", ordinal: 0, tool_name: "a", status: "running", started_at_ms: 1 },
        { tool_call_id: "t-2", ordinal: 2, tool_name: "b", status: "running", started_at_ms: 1 },
      ],
      memory_lineage: [
        {
          lineage_seq: 1,
          relation: "used",
          memory_kind: "fact",
          memory_reference: "ref-1",
          tenant_id: "t",
          user_id: "u",
          agent_id: "a",
          workspace_id: "w",
          occurred_at_ms: 1,
        },
      ],
    };

    const s: RunInspectorState = {
      snapshots: { "run-1": initial },
      pending: {},
      status: "live",
      selectedRunId: "run-1",
      refreshGeneration: 1,
    };

    // Incoming page has duplicate evt-1 and new evt-2 (seq 2)
    const eventPage: RunSnapshotDto = {
      ...snapshot("run-1"),
      events: [event(1, "evt-1"), event(2, "evt-2")],
      next_event_cursor: null,
    };

    const mergedEvents = mergeStreamPage(s, "run-1", "events", eventPage, 1);
    expect(mergedEvents.snapshots["run-1"].events.map((e) => e.event_seq)).toEqual([1, 2, 3]);

    // Incoming tools page has duplicate t-1:0 and new t-1:1
    const toolPage: RunSnapshotDto = {
      ...snapshot("run-1"),
      tool_calls: [
        { tool_call_id: "t-1", ordinal: 0, tool_name: "a", status: "completed", started_at_ms: 1 },
        { tool_call_id: "t-1", ordinal: 1, tool_name: "a", status: "running", started_at_ms: 1 },
      ],
      next_tool_cursor: null,
    };

    const mergedTools = mergeStreamPage(s, "run-1", "tools", toolPage, 1);
    expect(
      mergedTools.snapshots["run-1"].tool_calls.map((t) => `${t.tool_call_id}:${t.ordinal}`)
    ).toEqual(["t-1:0", "t-1:1", "t-2:2"]);
  });

  it("discards late pages when refresh generation changes or run is unselected", () => {
    const initial = snapshot("run-1");
    const s: RunInspectorState = {
      snapshots: { "run-1": initial },
      pending: {},
      status: "live",
      selectedRunId: "run-1",
      refreshGeneration: 2,
    };

    const page: RunSnapshotDto = {
      ...snapshot("run-1"),
      events: [event(2, "evt-2")],
      next_event_cursor: "next",
    };

    // Stale generation 1 vs current 2
    const staleResult = mergeStreamPage(s, "run-1", "events", page, 1);
    expect(staleResult.snapshots["run-1"].events).toHaveLength(0);

    // Mismatched selected run
    const wrongRunResult = mergeStreamPage(
      { ...s, selectedRunId: "run-2" },
      "run-1",
      "events",
      page,
      2
    );
    expect(wrongRunResult.snapshots["run-1"].events).toHaveLength(0);
  });

  it("invalidates extra loaded tool pages on authoritative refresh", () => {
    useRunInspectorStore.getState().clear();
    const initial = snapshot("run-1");
    useRunInspectorStore.getState().select("run-1");
    useRunInspectorStore.getState().snapshot(initial);

    // Page tools in
    const toolPage: RunSnapshotDto = {
      ...snapshot("run-1"),
      tool_calls: [
        { tool_call_id: "tool-page-2", ordinal: 201, tool_name: "test", status: "completed", started_at_ms: 1 },
      ],
      next_tool_cursor: "page-3-cursor",
    };
    useRunInspectorStore
      .getState()
      .pageStream(
        "run-1",
        "tools",
        toolPage,
        useRunInspectorStore.getState().refreshGeneration
      );
    expect(useRunInspectorStore.getState().snapshots["run-1"].tool_calls).toHaveLength(1);

    // Now authoritative refresh arrives from server with fresh baseline
    const refreshedBaseline: RunSnapshotDto = {
      ...snapshot("run-1", 2),
      tool_calls: [
        { tool_call_id: "tool-fresh-1", ordinal: 0, tool_name: "test", status: "running", started_at_ms: 1 },
      ],
      next_tool_cursor: "fresh-page-2-cursor",
    };
    const gen = useRunInspectorStore.getState().begin();
    useRunInspectorStore.getState().snapshot(refreshedBaseline, gen);

    // The previously paged tool-page-2 is invalidated; baseline is installed
    const current = useRunInspectorStore.getState().snapshots["run-1"];
    expect(current.tool_calls).toHaveLength(1);
    expect(current.tool_calls[0].tool_call_id).toBe("tool-fresh-1");
    expect(current.next_tool_cursor).toBe("fresh-page-2-cursor");
  });

  it("clears next_debug_cursor when debug is cleared or expired", () => {
    const snapWithDebug: RunSnapshotDto = {
      ...snapshot("run-1"),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "prompt",
          created_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60_000,
          plaintext_bytes: 6,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "dbg-next",
    };

    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(snapWithDebug);
    expect(useRunInspectorStore.getState().snapshots["run-1"].next_debug_cursor).toBe("dbg-next");

    useRunInspectorStore.getState().clearDebug("run-1");
    expect(useRunInspectorStore.getState().snapshots["run-1"].next_debug_cursor).toBeNull();
    expect(useRunInspectorStore.getState().snapshots["run-1"].debug_excerpts).toBeUndefined();
  });

  it("manages historical approvals per run and evicts/clears them", () => {
    const sampleApproval: ToolApprovalSnapshot = {
      approval_id: "app-1",
      schema_version: "tool_approval.v1",
      tenant_id: "tenant",
      user_id: "user",
      workspace_id: "workspace",
      session_id: "session",
      run_id: "run-1",
      tool_call_id: "call-1",
      ordinal: 0,
      tool_name: "shell",
      operation: "execute",
      risk: "high",
      state: "consumed",
      safe_summary: { program: "ls", args_count: 0, working_dir: "/ws" },
      binding_digest: "digest-1",
      revision: 1,
      created_at_ms: 100,
      expires_at_ms: 200,
      terminal_at_ms: 150,
      terminal_code: "consumed",
      decision_by_credential_id: "cred-1",
      redaction: "metadata_only",
    };

    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().setHistoricalApprovals("run-1", [sampleApproval]);
    expect(useRunInspectorStore.getState().historicalApprovals?.["run-1"]).toHaveLength(1);

    useRunInspectorStore.getState().evict("run-1");
    expect(useRunInspectorStore.getState().historicalApprovals?.["run-1"]).toBeUndefined();

    useRunInspectorStore.getState().setHistoricalApprovals("run-2", [sampleApproval]);
    useRunInspectorStore.getState().clear();
    expect(useRunInspectorStore.getState().historicalApprovals).toEqual({});
  });
  it("fences deferred debug page 2 after clearDebug has been called", () => {
    const snapWithDebug: RunSnapshotDto = {
      ...snapshot("run-1"),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "prompt page 1",
          created_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60_000,
          plaintext_bytes: 13,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "dbg-page-2",
    };

    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(snapWithDebug);
    const initialGen = useRunInspectorStore.getState().refreshGeneration ?? 0;
    const initialDebugGen = useRunInspectorStore.getState().debugGeneration ?? 0;

    // User opts out / clears debug
    useRunInspectorStore.getState().clearDebug("run-1");
    expect(useRunInspectorStore.getState().snapshots["run-1"].debug_excerpts).toBeUndefined();
    expect(useRunInspectorStore.getState().snapshots["run-1"].next_debug_cursor).toBeNull();

    // Delayed debug page 2 arrives with old debug generation
    const delayedPage: RunSnapshotDto = {
      ...snapWithDebug,
      debug_excerpts: [
        {
          excerpt_seq: 2,
          kind: "user_request",
          plaintext: "AUDIT_LATE_PRIVATE",
          created_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60_000,
          plaintext_bytes: 18,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "dbg-page-3",
    };

    useRunInspectorStore.getState().pageStream("run-1", "debug", delayedPage, initialGen, initialDebugGen);

    // Assert plaintext and cursor were NOT restored
    const current = useRunInspectorStore.getState().snapshots["run-1"];
    expect(current.debug_excerpts).toBeUndefined();
    expect(current.next_debug_cursor).toBeNull();
  });

  it("fences deferred debug page 2 after expire has occurred", () => {
    const now = Date.now();
    const snapWithDebug: RunSnapshotDto = {
      ...snapshot("run-1"),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "prompt page 1",
          created_at_ms: now - 10_000,
          expires_at_ms: now - 1_000, // expired
          plaintext_bytes: 13,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "dbg-page-2",
    };

    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(snapWithDebug);
    const initialGen = useRunInspectorStore.getState().refreshGeneration ?? 0;
    const initialDebugGen = useRunInspectorStore.getState().debugGeneration ?? 0;

    // Trigger expiry
    useRunInspectorStore.getState().expire(now);
    expect(useRunInspectorStore.getState().snapshots["run-1"].debug_excerpts).toBeUndefined();

    // Delayed debug page arrives
    const delayedPage: RunSnapshotDto = {
      ...snapWithDebug,
      debug_excerpts: [
        {
          excerpt_seq: 2,
          kind: "user_request",
          plaintext: "AUDIT_LATE_PRIVATE",
          created_at_ms: now,
          expires_at_ms: now + 60_000,
          plaintext_bytes: 18,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "dbg-page-3",
    };

    useRunInspectorStore.getState().pageStream("run-1", "debug", delayedPage, initialGen, initialDebugGen);

    const current = useRunInspectorStore.getState().snapshots["run-1"];
    expect(current.debug_excerpts).toBeUndefined();
    expect(current.next_debug_cursor).toBeNull();
  });

  it("preserves newer live event hints when older REST snapshot arrives", () => {
    const base = snapshot("run-1");
    base.run.snapshot_seq = 5;
    base.run.lifecycle_status = "running";

    useRunInspectorStore.getState().clear();
    useRunInspectorStore.getState().snapshot(base);

    // Live terminal hint arrives via event
    const liveEvent: RunEventDto = {
      event_id: "evt-terminal-6",
      event_seq: 6,
      event_kind: "lifecycle",
      occurred_at_ms: 1000,
      lifecycle_status: "completed",
    };
    useRunInspectorStore.getState().event("run-1", liveEvent);

    const currentAfterEvent = useRunInspectorStore.getState().snapshots["run-1"];
    expect(currentAfterEvent.run.snapshot_seq).toBe(6);
    expect(currentAfterEvent.run.lifecycle_status).toBe("completed");

    // Older REST response arrives with snapshot_seq = 5 and lifecycle_status = "running"
    const olderRestSnapshot = {
      ...base,
      run: {
        ...base.run,
        snapshot_seq: 5,
        lifecycle_status: "running" as const,
      },
      events: [...base.events],
    };

    useRunInspectorStore.getState().snapshot(olderRestSnapshot);

    // Verify it did NOT roll back to snapshot_seq 5 or "running"
    const currentAfterRest = useRunInspectorStore.getState().snapshots["run-1"];
    expect(currentAfterRest.run.snapshot_seq).toBe(6);
    expect(currentAfterRest.run.lifecycle_status).toBe("completed");
    expect(currentAfterRest.events.some((e) => e.event_seq === 6)).toBe(true);
  });
});
