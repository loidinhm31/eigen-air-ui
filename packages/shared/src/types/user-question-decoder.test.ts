import { describe, expect, it } from "vitest";
import {
  decodeChatSendResponse,
  decodeChatHistoryResponse,
  decodeRunSnapshot,
  decodeUserQuestionAnswer,
  decodeUserQuestionEvent,
  decodeUserQuestionList,
  decodeUserQuestionRequest,
  decodeUserQuestionSnapshot,
  decodeWsFrameJson,
} from "./user-question-decoder.js";

const metadata = {
  schema_version: "user_question.v1",
  question_id: "question-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
  run_id: "run-1",
  turn_index: 1,
  state: "pending",
  revision: 2,
  created_at_ms: 1_700_000_000_000,
  expires_at_ms: 1_700_086_400_000,
  terminal_at_ms: null,
  redaction: "metadata_only",
} as const;

describe("G3 user-question decoders", () => {
  it("accepts exactly the three supported request kinds", () => {
    expect(
      decodeUserQuestionRequest({
        kind: "single_choice",
        prompt: "Pick one",
        options: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      }).kind
    ).toBe("single_choice");
    expect(decodeUserQuestionRequest({ kind: "short_text", prompt: "Name" }).kind).toBe(
      "short_text"
    );
    expect(decodeUserQuestionRequest({ kind: "multiline", prompt: "Context" }).kind).toBe(
      "multiline"
    );
  });

  it("fails closed for approval-like, duplicate, and oversized shapes", () => {
    expect(() =>
      decodeUserQuestionRequest({ kind: "approval", prompt: "Allow action?" })
    ).toThrow();
    expect(() =>
      decodeUserQuestionRequest({
        kind: "single_choice",
        prompt: "Pick",
        options: [
          { id: "same", label: "One" },
          { id: "same", label: "Two" },
        ],
      })
    ).toThrow();
    expect(() =>
      decodeUserQuestionRequest({ kind: "short_text", prompt: "x".repeat(2049) })
    ).toThrow();
  });

  it("keeps hostile text as data and only accepts a strict pending token", () => {
    const snapshot = decodeUserQuestionSnapshot({
      ...metadata,
      request: { kind: "short_text", prompt: '<script>alert("x")</script>' },
      mutation_token: "a".repeat(32),
    });
    expect(snapshot.request?.prompt).toContain("<script>");
    expect(snapshot.mutation_token).toBe("a".repeat(32));
    expect(() =>
      decodeUserQuestionSnapshot({
        ...metadata,
        request: { kind: "short_text", prompt: "safe" },
        mutation_token: "answer-and-token-leak",
      })
    ).toThrow();
  });

  it("decodes REST lists, sequenced metadata hints, and waiting responses", () => {
    expect(
      decodeUserQuestionList({
        schema_version: "user_question.v1",
        questions: [metadata],
        redaction: "metadata_only",
      }).questions
    ).toHaveLength(1);
    const event = decodeUserQuestionEvent({
      type: "event",
      version: "v1",
      event: "user_question.updated",
      session_id: "session-1",
      run_id: "run-1",
      payload: { question_id: "question-1", state: "pending", revision: 2 },
    });
    expect(event.payload.revision).toBe(2);
    const waiting = decodeChatSendResponse({
      status: "waiting_for_input",
      run_id: "run-1",
      question_id: "question-1",
      snapshot_ref: "user_question:question-1",
    });
    expect("status" in waiting ? waiting.status : undefined).toBe("waiting_for_input");
  });

  it("rejects malformed, unbounded, and unknown websocket envelopes", () => {
    expect(decodeWsFrameJson("not-json")).toBeUndefined();
    expect(
      decodeWsFrameJson(JSON.stringify({ type: "event", event: "user_question.updated" }))
    ).toBeUndefined();
    expect(decodeWsFrameJson("x".repeat(64 * 1024 + 1))).toBeUndefined();
    expect(decodeWsFrameJson(JSON.stringify({ type: "unknown" }))).toBeUndefined();
  });

  it("bounds answers and mirrors the input-only semantics", () => {
    const request = { kind: "short_text" as const, prompt: "Name" };
    expect(decodeUserQuestionAnswer({ kind: "short_text", text: "Ada" }, request)).toEqual({
      kind: "short_text",
      text: "Ada",
    });
    expect(() =>
      decodeUserQuestionAnswer({ kind: "short_text", text: "allow this" }, request)
    ).toThrow();
    expect(() =>
      decodeUserQuestionAnswer({ kind: "multiline", text: `${"x".repeat(4096)}x` }, {
        kind: "multiline",
        prompt: "Context",
      })
    ).toThrow();
    expect(() =>
      decodeUserQuestionAnswer({ kind: "single_choice", option_id: "other" }, {
        kind: "single_choice",
        prompt: "Pick",
        options: [
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ],
      })
    ).toThrow();
  });

  it("requires bounded history and run snapshot barriers", () => {
    expect(decodeChatHistoryResponse({ messages: [{ role: "assistant", content: "done" }] })).toEqual({
      messages: [{ role: "assistant", content: "done" }],
    });
    expect(
      decodeChatHistoryResponse({
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                name: "user_question",
                arguments: { kind: "short_text", prompt: "Color?" },
              },
            ],
          },
          {
            role: "tool",
            content: "response_received",
            tool_call_id: "call-1",
          },
          {
            role: "assistant",
            content: "Got it",
            debug: {
              provider: "openai_compatible",
              model: "test-model",
              system_prompt: "sys",
              reasoning: { requested: true, available: true, text: "thought" },
            },
          },
        ],
      }).messages
    ).toHaveLength(4);
    expect(() =>
      decodeChatHistoryResponse({ messages: [{ role: "assistant", content: "x".repeat(65 * 1024) }] })
    ).toThrow();
    expect(() =>
      decodeChatHistoryResponse({ messages: [{ role: "unsupported", content: "hi" }] })
    ).toThrow();
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "", tool_calls: [{ name: "missing_id" }] }],
      })
    ).toThrow();
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "tool", content: "ok", unknown_key: true }],
      })
    ).toThrow();
    const run = {
      schema_version: 1,
      run: {
        run_id: "run-1",
        trace_id: "trace-1",
        session_id: "session-1",
        root_run_id: "run-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        workspace_id: "workspace-1",
        agent_id: "agent-1",
        provider_id: "provider-1",
        channel: "web",
        lifecycle_status: "running",
        started_at_ms: 1,
        updated_at_ms: 1,
        snapshot_seq: 1,
        correlation_state: "active",
        redaction: { metadata_only: true, debug_requested: false, debug_available: false },
      },
      events: [],
      tool_calls: [],
      memory_lineage: [],
    };
    expect(decodeRunSnapshot(run, "run-1").run.run_id).toBe("run-1");
    expect(
      decodeRunSnapshot(
        {
          ...run,
          task_progress: {
            artifact_id: "artifact-1",
            artifact_type: "task_progress",
            schema_version: 1,
            root_session_id: "session-1",
            task_id: "task-1",
            subagent_run_id: "subrun-1",
            run_id: "run-1",
            trace_id: "trace-1",
            parent_run_id: "parent-run-1",
            root_run_id: "run-1",
            projection_status: "running",
            verification_status: "unverified",
            artifact_revision: 1,
            artifact_event_seq: 1,
            g2_snapshot_seq: 1,
            updated_at_ms: 1,
            terminal_at_ms: null,
            claimed_item_count: 0,
            claimed_active_count: 0,
            redaction: { metadata_only: true, hidden_fields: ["claimed_items.label"] },
          },
        },
        "run-1"
      ).task_progress?.run_id
    ).toBe("run-1");
    expect(() => decodeRunSnapshot(run, "run-2")).toThrow();
  });

  it("decodes chat send and history responses with multi-KiB debug excerpts, truncation, and repeated tool calls", () => {
    const longSystemPrompt = "You are eigen-air, an AI assistant...".repeat(30);
    const longReasoning = "Step 1: Analyze user request...".repeat(50);
    const sendResponse = decodeChatSendResponse({
      content: "Here is your summary.",
      tool_calls_made: 3,
      tool_limit_reached: false,
      repeated_tool_call: true,
      can_continue: true,
      memory_updated: true,
      memory_reason: "stored",
      episode_id: "ep-1",
      message_id: "msg-1",
      fact_count: 2,
      truncation: { reason: "max_tokens" },
      debug: {
        provider: "local_llama",
        model: "gemma-4-e4b-it-qat",
        system_prompt: longSystemPrompt,
        reasoning: {
          requested: true,
          available: true,
          text: longReasoning,
        },
      },
    });
    expect("content" in sendResponse ? sendResponse.content : "").toBe("Here is your summary.");
    expect("repeated_tool_call" in sendResponse ? sendResponse.repeated_tool_call : undefined).toBe(true);
    expect("truncation" in sendResponse ? sendResponse.truncation?.reason : undefined).toBe("max_tokens");

    const historyResponse = decodeChatHistoryResponse({
      messages: [
        {
          role: "assistant",
          content: "Here is your summary.",
          debug: {
            provider: "local_llama",
            model: "gemma-4-e4b-it-qat",
            system_prompt: longSystemPrompt,
            reasoning: {
              requested: true,
              available: true,
              text: longReasoning,
            },
          },
        },
      ],
    });
    expect(historyResponse.messages[0].debug?.system_prompt).toBe(longSystemPrompt);
    expect(historyResponse.messages[0].debug?.reasoning?.text).toBe(longReasoning);
  });

  it("strictly decodes optional run_id locator and rejects invalid or unknown keys (V15)", () => {
    // Valid run_id present
    const validHistory = decodeChatHistoryResponse({
      messages: [
        {
          id: "msg-sess-1-0",
          run_id: "run-019234-canonical",
          role: "assistant",
          content: "Valid response with canonical run locator",
        },
      ],
    });
    expect(validHistory.messages[0].id).toBe("msg-sess-1-0");
    expect(validHistory.messages[0].run_id).toBe("run-019234-canonical");

    // Missing run_id accepted (backward compatible legacy history)
    const legacyHistory = decodeChatHistoryResponse({
      messages: [
        {
          id: "msg-sess-1-0",
          role: "assistant",
          content: "Legacy response without run locator",
        },
      ],
    });
    expect(legacyHistory.messages[0].id).toBe("msg-sess-1-0");
    expect(legacyHistory.messages[0].run_id).toBeUndefined();
    expect(legacyHistory.messages[0].content).toBe("Legacy response without run locator");

    // Null run_id rejected
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "test", run_id: null }],
      })
    ).toThrow();

    // Empty string run_id rejected
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "test", run_id: "" }],
      })
    ).toThrow();

    // Wrong type run_id rejected
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "test", run_id: 12345 }],
      })
    ).toThrow();

    // Oversized run_id (> 512 bytes) rejected
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "test", run_id: "a".repeat(513) }],
      })
    ).toThrow();

    // Unknown key (e.g. camelCase runId or unexpected payload) rejected
    expect(() =>
      decodeChatHistoryResponse({
        messages: [{ role: "assistant", content: "test", runId: "run-1" }],
      })
    ).toThrow();
  });

  it("preserves distinct message IDs and run locators for duplicate answers and legacy rows (V03, V04, V15)", () => {
    const history = decodeChatHistoryResponse({
      messages: [
        {
          id: "msg-sessA-turn1-0",
          run_id: "run-canonical-turn1",
          role: "assistant",
          content: "Done",
        },
        {
          id: "msg-sessA-turn2-0",
          run_id: "run-canonical-turn2",
          role: "assistant",
          content: "Done",
        },
        {
          id: "msg-ep-sessA-0-1",
          role: "assistant",
          content: "Legacy fallback without correlation",
        },
      ],
    });

    expect(history.messages).toHaveLength(3);
    // Distinct identities and run IDs despite identical content "Done"
    expect(history.messages[0].content).toBe("Done");
    expect(history.messages[0].id).toBe("msg-sessA-turn1-0");
    expect(history.messages[0].run_id).toBe("run-canonical-turn1");

    expect(history.messages[1].content).toBe("Done");
    expect(history.messages[1].id).toBe("msg-sessA-turn2-0");
    expect(history.messages[1].run_id).toBe("run-canonical-turn2");

    // Third message lacks run_id and preserves content
    expect(history.messages[2].content).toBe("Legacy fallback without correlation");
    expect(history.messages[2].id).toBe("msg-ep-sessA-0-1");
    expect(history.messages[2].run_id).toBeUndefined();
  });
});
