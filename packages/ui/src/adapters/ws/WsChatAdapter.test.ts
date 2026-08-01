import { describe, expect, it } from "vitest";
import { buildChatSendParams, projectRunCorrelation } from "./WsChatAdapter.js";

describe("projectRunCorrelation", () => {
  it("projects only durable correlation metadata and ignores legacy frames", () => {
    expect(
      projectRunCorrelation({
        type: "event",
        event: "run.delta",
        payload: { delta: "legacy content" },
      })
    ).toBeUndefined();

    const projected = projectRunCorrelation({
      type: "event",
      version: "v1",
      event: "run.finished",
      run_id: "run-a",
      event_id: "event-2",
      event_seq: 2,
      occurred_at_ms: 2,
      payload: {
        run_id: "request-a",
        content: "sensitive response",
        tool_calls_made: 0,
        lifecycle_status: "completed",
      },
    });
    expect(projected).toEqual({
      event: "run.finished",
      run_id: "run-a",
      event_id: "event-2",
      event_seq: 2,
      occurred_at_ms: 2,
      lifecycle_status: "completed",
    });
    expect(JSON.stringify(projected)).not.toContain("sensitive response");
  });

  it("projects an explicit metadata-only refetch signal without run correlation", () => {
    expect(
      projectRunCorrelation({
        type: "event",
        version: "v1",
        event: "run.delta",
        payload: { delta: "sensitive delta", snapshot_refetch_required: true },
      })
    ).toEqual({
      event: "run.delta",
      run_id: undefined,
      event_id: undefined,
      event_seq: undefined,
      occurred_at_ms: undefined,
      snapshot_refetch_required: true,
    });
  });
});

describe("buildChatSendParams", () => {
  it("omits selected_skill_id when no skill is selected", () => {
    expect(buildChatSendParams("hello", "session-1")).toEqual({
      message: "hello",
      stream: true,
      session_id: "session-1",
    });
  });

  it("passes through only the exact selected skill ID transport field", () => {
    const selectedSkillId = "x".repeat(256);

    expect(buildChatSendParams("ordinary message", undefined, { selectedSkillId })).toEqual({
      message: "ordinary message",
      stream: true,
      selected_skill_id: selectedSkillId,
    });
  });

  it("does not derive or serialize prompt and template keys", () => {
    const params = buildChatSendParams("review this", undefined, {
      selectedSkillId: "code_review",
    });

    expect(Object.keys(params)).toEqual(["message", "stream", "selected_skill_id"]);
    expect(params).not.toHaveProperty("selectedSkillId");
    expect(params).not.toHaveProperty("prompt");
    expect(params).not.toHaveProperty("template");
    expect(params).not.toHaveProperty("instructions");
  });
});
