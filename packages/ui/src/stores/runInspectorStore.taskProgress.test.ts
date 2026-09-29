import { beforeEach, describe, expect, it } from "vitest";
import type {
  RunSnapshotDto,
  TaskProgressWsEvent,
} from "@eigen-air-ui/shared/types";
import { useRunInspectorStore } from "./runInspectorStore.js";

function baseSnapshot(runId = "run-1"): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: runId,
      trace_id: "trace-1",
      session_id: "session-1",
      root_run_id: runId,
      parent_run_id: null,
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "ws-1",
      agent_id: "agent-1",
      provider_id: "prov-1",
      channel: "web",
      lifecycle_status: "running",
      started_at_ms: 1000,
      updated_at_ms: 1000,
      completed_at_ms: null,
      snapshot_seq: 10,
      correlation_state: "correlated",
      redaction: {
        metadata_only: true,
        debug_requested: false,
        debug_available: false,
      },
    },
    events: [],
    tool_calls: [],
    memory_lineage: [],
    task_progress: {
      artifact_type: "task_progress",
      schema_version: 1,
      artifact_id: "art-1",
      root_session_id: "session-root",
      task_id: "task-1",
      subagent_run_id: runId,
      run_id: runId,
      trace_id: "trace-1",
      parent_run_id: null,
      root_run_id: runId,
      projection_status: "running",
      verification_status: "unverified",
      artifact_revision: 5,
      artifact_event_seq: 8,
      g2_snapshot_seq: 10,
      claimed_active_count: 2,
      claimed_item_count: 4,
      updated_at_ms: 1000,
      terminal_at_ms: null,
      redaction: {
        metadata_only: true,
        hidden_fields: ["claimed_items.label"],
      },
    },
  };
}

function progressEvent(overrides: Partial<TaskProgressWsEvent["payload"]> = {}): TaskProgressWsEvent {
  return {
    type: "event",
    version: "v1",
    event: "task_progress.updated",
    run_id: "run-1",
    payload: {
      artifact_id: "art-1",
      task_id: "task-1",
      subagent_run_id: "run-1",
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "running",
      verification_status: "unverified",
      ...overrides,
    },
  };
}

describe("runInspectorStore task progress reconciliation", () => {
  beforeEach(() => {
    useRunInspectorStore.getState().clear();
  });

  it("applies in-order contiguous progress update", () => {
    const store = useRunInspectorStore.getState();
    store.snapshot(baseSnapshot("run-1"));
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.artifact_revision).toBe(5);

    useRunInspectorStore.getState().taskProgressEvent("run-1", progressEvent());

    const updated = useRunInspectorStore.getState().snapshots["run-1"].task_progress;
    expect(updated?.artifact_revision).toBe(6);
    expect(updated?.artifact_event_seq).toBe(9);
    expect(updated?.g2_snapshot_seq).toBe(11);
    expect(useRunInspectorStore.getState().status).toBe("live");
  });

  it("ignores duplicate task progress updates", () => {
    const store = useRunInspectorStore.getState();
    store.snapshot(baseSnapshot("run-1"));

    // Duplicate matching current revision/seq exactly
    const dupEvent = progressEvent({
      artifact_revision: 5,
      artifact_event_seq: 8,
      snapshot_seq: 10,
      projection_status: "running",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", dupEvent);

    const snapshot = useRunInspectorStore.getState().snapshots["run-1"].task_progress;
    expect(snapshot?.artifact_revision).toBe(5);
    expect(useRunInspectorStore.getState().status).toBe("live");
  });

  it("triggers reconciling on out-of-order sequence gap or snapshot_refetch_required", () => {
    const store = useRunInspectorStore.getState();
    store.snapshot(baseSnapshot("run-1"));

    // Gap: revision skips from 5 to 8
    const gapEvent = progressEvent({
      artifact_revision: 8,
      artifact_event_seq: 12,
      snapshot_seq: 15,
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", gapEvent);
    expect(useRunInspectorStore.getState().status).toBe("reconciling");

    // Reset status to live
    useRunInspectorStore.setState({ status: "live" });

    // Explicit refetch required
    const refetchEvent = progressEvent({
      snapshot_refetch_required: true,
    });
    useRunInspectorStore.getState().taskProgressEvent("run-1", refetchEvent);
    expect(useRunInspectorStore.getState().status).toBe("reconciling");
  });

  it("triggers reconciling when snapshot has no prior task_progress projection", () => {
    const snapshotWithoutG6 = {
      ...baseSnapshot("run-1"),
      task_progress: null,
    };
    useRunInspectorStore.getState().snapshot(snapshotWithoutG6);

    useRunInspectorStore.getState().taskProgressEvent("run-1", progressEvent());
    expect(useRunInspectorStore.getState().status).toBe("reconciling");
  });

  it("preserves cancellation authority: late succeeded hint cannot overwrite cancelled snapshot", () => {
    const cancelledSnapshot: RunSnapshotDto = {
      ...baseSnapshot("run-1"),
      task_progress: {
        ...baseSnapshot("run-1").task_progress!,
        projection_status: "cancelled",
      },
    };
    useRunInspectorStore.getState().snapshot(cancelledSnapshot);

    // Contiguous update claiming succeeded
    const succeededEvent = progressEvent({
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "succeeded",
      verification_status: "verified_success",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", succeededEvent);

    const result = useRunInspectorStore.getState().snapshots["run-1"].task_progress;
    // Status must remain cancelled, authority is preserved!
    expect(result?.projection_status).toBe("cancelled");
    expect(result?.artifact_revision).toBe(6);
  });

  it("preserves cancellation when run lifecycle status is aborted", () => {
    const abortedRunSnapshot: RunSnapshotDto = {
      ...baseSnapshot("run-1"),
      run: {
        ...baseSnapshot("run-1").run,
        lifecycle_status: "aborted",
      },
    };
    useRunInspectorStore.getState().snapshot(abortedRunSnapshot);

    const succeededEvent = progressEvent({
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "succeeded",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", succeededEvent);
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.projection_status).toBe("cancelled");
  });
  it("preserves failure authority: late succeeded or running hint cannot overwrite failed snapshot", () => {
    const failedSnapshot: RunSnapshotDto = {
      ...baseSnapshot("run-1"),
      task_progress: {
        ...baseSnapshot("run-1").task_progress!,
        projection_status: "failed",
      },
    };
    useRunInspectorStore.getState().snapshot(failedSnapshot);

    const succeededEvent = progressEvent({
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "succeeded",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", succeededEvent);
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.projection_status).toBe("failed");

    const runningEvent = progressEvent({
      artifact_revision: 7,
      artifact_event_seq: 10,
      snapshot_seq: 12,
      projection_status: "running",
    });
    useRunInspectorStore.getState().taskProgressEvent("run-1", runningEvent);
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.projection_status).toBe("failed");
  });

  it("preserves succeeded terminal status against late non-terminal hints", () => {
    const succeededSnapshot: RunSnapshotDto = {
      ...baseSnapshot("run-1"),
      task_progress: {
        ...baseSnapshot("run-1").task_progress!,
        projection_status: "succeeded",
      },
    };
    useRunInspectorStore.getState().snapshot(succeededSnapshot);

    const runningEvent = progressEvent({
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "running",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", runningEvent);
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.projection_status).toBe("succeeded");
  });
  it("preserves verification_status when terminal guard overrides conflicting projection_status", () => {
    const failedSnapshot: RunSnapshotDto = {
      ...baseSnapshot("run-1"),
      task_progress: {
        ...baseSnapshot("run-1").task_progress!,
        projection_status: "failed",
        verification_status: "verified_failure",
      },
    };
    useRunInspectorStore.getState().snapshot(failedSnapshot);

    const succeededEvent = progressEvent({
      artifact_revision: 6,
      artifact_event_seq: 9,
      snapshot_seq: 11,
      projection_status: "succeeded",
      verification_status: "verified_success",
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", succeededEvent);
    const updated = useRunInspectorStore.getState().snapshots["run-1"].task_progress;
    expect(updated?.projection_status).toBe("failed");
    expect(updated?.verification_status).toBe("verified_failure");
  });

  it("rejects revision rollback: lower artifact_revision is discarded", () => {
    useRunInspectorStore.getState().snapshot(baseSnapshot("run-1"));

    // Stale event with revision lower than 5
    const staleEvent = progressEvent({
      artifact_revision: 4,
      artifact_event_seq: 7,
      snapshot_seq: 9,
    });

    useRunInspectorStore.getState().taskProgressEvent("run-1", staleEvent);
    expect(useRunInspectorStore.getState().snapshots["run-1"].task_progress?.artifact_revision).toBe(5);
  });
});
