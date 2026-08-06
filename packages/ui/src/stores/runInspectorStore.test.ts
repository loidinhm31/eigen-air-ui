import { describe, expect, it, vi } from "vitest";
import type { RunEventDto, RunSnapshotDto } from "@nonclaw-ui/shared/types";
import {
  applyRunEvent,
  installSnapshot,
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
});
