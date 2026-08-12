import { describe, expect, it } from "vitest";
import type { WsEvent } from "@nonclaw-ui/shared/types";
import { decodeInboundWsEvent } from "./WsClient.js";

const taskUpdate = {
  type: "event",
  version: "v1",
  event: "task_progress.updated",
  request_id: "request-1",
  event_id: "event-2",
  event_seq: 2,
  occurred_at_ms: 2,
  session_id: "session-1",
  run_id: "run-1",
  trace_id: "trace-1",
  parent_run_id: "parent-1",
  root_run_id: "root-1",
  payload: {
    artifact_id: "artifact-1",
    task_id: "task-1",
    subagent_run_id: "subagent-1",
    artifact_revision: 1,
    artifact_event_seq: 1,
    projection_status: "running",
    verification_status: "unverified",
    snapshot_seq: 2,
  },
} as WsEvent;

describe("decodeInboundWsEvent", () => {
  it("preserves legacy events and accepts a valid G6 update", () => {
    const legacy = { type: "event", event: "run.delta", payload: { delta: "legacy" } } as WsEvent;
    expect(decodeInboundWsEvent(legacy)).toBe(legacy);
    expect(decodeInboundWsEvent(taskUpdate)).toMatchObject({ event: "task_progress.updated" });
  });

  it("drops malformed G6 updates before event subscribers receive them", () => {
    const malformed = {
      ...taskUpdate,
      payload: { ...taskUpdate.payload, artifact_id: false },
    } as unknown as WsEvent;
    expect(decodeInboundWsEvent(malformed)).toBeUndefined();
  });
});
