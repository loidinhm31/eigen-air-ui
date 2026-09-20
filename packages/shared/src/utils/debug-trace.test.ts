import { describe, expect, it, vi } from "vitest";
import { buildDebugTrace, copyDebugTrace } from "./debug-trace.js";

describe("debug-trace", () => {
  it("builds a complete debug trace snapshot from provided options", () => {
    const trace = buildDebugTrace({
      sessionId: "session-123",
      daemonUrl: "http://localhost:18790",
      connectionStatus: "connected",
      connectionVersion: "v1",
      message: {
        id: "msg-1",
        role: "assistant",
        content: "hello world",
        tool_calls: [{ id: "call-1", name: "test_tool" }],
        tool_call_id: "call-0",
      },
      debug: {
        provider: "local_llama",
        model: "gemma-4-e4b-it-qat",
        active_skill: { name: "test_skill", score: 0.95 },
        system_prompt: "You are a helpful assistant.",
        reasoning: { requested: true, available: true, text: "thinking..." },
      },
      questionState: {
        status: "ready",
        error: null,
        activeQuestionId: "q-1",
      },
      streamState: {
        status: "idle",
        error: null,
      },
    });

    expect(trace.timestamp).toBeTruthy();
    expect(trace.session_id).toBe("session-123");
    expect(trace.daemon_url).toBe("http://localhost:18790");
    expect(trace.connection_status).toBe("connected");
    expect(trace.connection_version).toBe("v1");
    expect(trace.message).toEqual({
      id: "msg-1",
      role: "assistant",
      content: "hello world",
      tool_calls: [{ id: "call-1", name: "test_tool" }],
      tool_call_id: "call-0",
    });
    expect(trace.debug?.provider).toBe("local_llama");
    expect(trace.debug?.model).toBe("gemma-4-e4b-it-qat");
    expect(trace.debug?.active_skill?.name).toBe("test_skill");
    expect(trace.debug?.system_prompt).toBe("You are a helpful assistant.");
    expect(trace.debug?.reasoning?.text).toBe("thinking...");
    expect(trace.question_state?.status).toBe("ready");
    expect(trace.question_state?.error).toBeNull();
    expect(trace.question_state?.active_question_id).toBe("q-1");
    expect(trace.stream_state?.status).toBe("idle");
    expect(trace.stream_state?.error).toBeNull();
  });

  it("handles minimal options gracefully", () => {
    const trace = buildDebugTrace({});
    expect(trace.timestamp).toBeTruthy();
    expect(trace.session_id).toBeUndefined();
    expect(trace.message).toBeUndefined();
    expect(trace.debug).toBeUndefined();
    expect(trace.question_state).toBeUndefined();
    expect(trace.stream_state).toBeUndefined();
  });

  it("copies formatted JSON to clipboard via navigator.clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    const trace = buildDebugTrace({ sessionId: "session-abc" });
    const result = await copyDebugTrace(trace);

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(trace, null, 2));

    vi.unstubAllGlobals();
  });

  it("falls back to document.execCommand when clipboard API throws", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const execCommand = vi.fn().mockReturnValue(true);

    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });
    vi.stubGlobal("document", {
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      createElement: vi.fn().mockReturnValue({
        style: {},
        focus: vi.fn(),
        select: vi.fn(),
      }),
      execCommand,
    });

    const result = await copyDebugTrace({ error: "test" });
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");

    vi.unstubAllGlobals();
  });
});
