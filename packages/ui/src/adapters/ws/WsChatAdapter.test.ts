import { describe, expect, it, vi } from "vitest";

const wsHarness = vi.hoisted(() => {
  const harness = {
    nextResponse: undefined as unknown,
    client: undefined as { emit: (event: unknown) => void } | undefined,
  };
  class FakeWsClient {
    private handlers: Array<(event: unknown) => void> = [];

    constructor(url: string) {
      void url;
      harness.client = this;
    }

    onEvent(handler: (event: unknown) => void) {
      this.handlers.push(handler);
    }

    removeEventHandler(handler: (event: unknown) => void) {
      this.handlers = this.handlers.filter((candidate) => candidate !== handler);
    }

    onConnectionStatus() {}
    onProtocolError() {}
    onReconnect() {}
    disconnect() {}
    async connect() {}

    async send() {
      return harness.nextResponse;
    }

    emit(event: unknown) {
      this.handlers.forEach((handler) => handler(event));
    }
  }
  return { harness, FakeWsClient };
});

vi.mock("./WsClient.js", () => ({ WsClient: wsHarness.FakeWsClient }));
import { buildChatSendParams, buildDebugRequest, projectRunCorrelation } from "./WsChatAdapter.js";

describe("buildDebugRequest", () => {
  it("omits debug payload when all toggles are disabled", () => {
    expect(buildDebugRequest()).toBeUndefined();
    expect(buildDebugRequest({ includePrompt: false, includeReasoning: false })).toBeUndefined();
  });

  it("maps UI settings to the websocket debug request shape", () => {
    expect(buildDebugRequest({ includePrompt: true, includeReasoning: false })).toEqual({
      include_prompt: true,
      include_reasoning: false,
    });
  });
});

describe("WsChatAdapter waiting lifecycle", () => {
  it("retains resumed events, then removes the handler on terminal question states", async () => {
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://daemon");
    const firstEvents: unknown[] = [];
    wsHarness.harness.nextResponse = {
      ok: true,
      data: {
        status: "waiting_for_input",
        run_id: "run-1",
        question_id: "question-1",
        snapshot_ref: "user_question:question-1",
      },
    };
    await adapter.sendMessage("start", "session-1", (event) => firstEvents.push(event));
    wsHarness.harness.client?.emit({
      type: "event",
      version: "v1",
      event: "user_question.updated",
      payload: { question_id: "question-1", state: "answered", revision: 2 },
    });
    wsHarness.harness.client?.emit({
      type: "event",
      version: "v1",
      event: "run.delta",
      payload: { delta: "resumed" },
    });
    expect(firstEvents.some((event) => (event as { event?: string }).event === "run.delta")).toBe(
      true
    );
    wsHarness.harness.client?.emit({
      type: "event",
      version: "v1",
      event: "user_question.updated",
      payload: { question_id: "question-1", state: "cancelled", revision: 3 },
    });
    wsHarness.harness.nextResponse = { ok: true, data: { content: "next", tool_calls_made: 0 } };
    const secondEvents: unknown[] = [];
    await adapter.sendMessage("next", "session-2", (event) => secondEvents.push(event));
    wsHarness.harness.client?.emit({
      type: "event",
      version: "v1",
      event: "run.delta",
      payload: { delta: "old" },
    });
    expect(secondEvents).toHaveLength(0);
  });
});

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
