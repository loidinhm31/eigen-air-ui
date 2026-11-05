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
  decodeWsInbound,
  MAX_WS_EVENT_FRAME_BYTES,
  MAX_WS_RESPONSE_FRAME_BYTES,
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

  it("decodes run snapshot debug excerpts with keywords, CRLF, and empty plaintext across kinds", () => {
    const createRun = (excerpts: Record<string, unknown>[]) => ({
      schema_version: 1,
      run: {
        run_id: "run-1",
        trace_id: "trace-1",
        request_id: null,
        session_id: "session-1",
        parent_run_id: null,
        root_run_id: "run-1",
        tenant_id: "tenant-1",
        user_id: "user-1",
        workspace_id: "workspace-1",
        agent_id: "agent-1",
        provider_id: "provider-1",
        channel: "cli",
        lifecycle_status: "completed",
        started_at_ms: 1,
        updated_at_ms: 2,
        snapshot_seq: 1,
        correlation_state: "active",
        redaction: { metadata_only: false, debug_requested: true, debug_available: true },
      },
      events: [],
      tool_calls: [],
      memory_lineage: [],
      debug_excerpts: excerpts,
    });

    const sampleText = "relative paths for file operations\r\nREADME.md file\r\ntoken allow deny password=[REDACTED]";
    const kinds = ["system_prompt", "provider_reasoning", "provider_response"] as const;
    const excerpts = kinds.map((kind, idx) => ({
      excerpt_seq: idx + 1,
      kind,
      plaintext: idx === 1 ? "" : sampleText,
      plaintext_bytes: idx === 1 ? 0 : 97,
      created_at_ms: idx + 1,
      expires_at_ms: idx + 2,
      truncated: false,
      redaction_count: idx === 0 ? 1 : 0,
    }));

    const decoded = decodeRunSnapshot(createRun(excerpts), "run-1");
    expect(decoded.debug_excerpts).toHaveLength(3);
    expect(decoded.debug_excerpts?.[0]?.plaintext).toBe(sampleText);
    expect(decoded.debug_excerpts?.[1]?.plaintext).toBe("");
    expect(decoded.debug_excerpts?.[2]?.plaintext).toBe(sampleText);

    // Exact ASCII byte boundary: 65,536 bytes accepted, 65,537 rejected
    const exact64k = decodeRunSnapshot(
      createRun([{ ...excerpts[0], plaintext: "a".repeat(65_536), plaintext_bytes: 65_536 }]),
      "run-1"
    );
    expect(exact64k.debug_excerpts?.[0]?.plaintext.length).toBe(65_536);
    expect(() =>
      decodeRunSnapshot(
        createRun([{ ...excerpts[0], plaintext: "a".repeat(65_537), plaintext_bytes: 65_537 }]),
        "run-1"
      )
    ).toThrow();

    // Multibyte UTF-8 boundary: 16,384 4-byte emojis = 65,536 bytes accepted, +1 byte rejected
    const exactEmoji = decodeRunSnapshot(
      createRun([{ ...excerpts[0], plaintext: "😀".repeat(16_384), plaintext_bytes: 65_536 }]),
      "run-1"
    );
    expect(exactEmoji.debug_excerpts?.[0]?.plaintext).toBe("😀".repeat(16_384));
    expect(() =>
      decodeRunSnapshot(
        createRun([{ ...excerpts[0], plaintext: "😀".repeat(16_384) + "a", plaintext_bytes: 65_537 }]),
        "run-1"
      )
    ).toThrow();

    // Full type rejection matrix for plaintext
    const invalidPlaintexts = [undefined, null, 12345, true, {}, []];
    for (const invalid of invalidPlaintexts) {
      expect(() =>
        decodeRunSnapshot(
          createRun([{ ...excerpts[0], plaintext: invalid }]),
          "run-1"
        )
      ).toThrow();
    }
    // Missing plaintext property rejected
    const missingPlaintext = Object.fromEntries(
      Object.entries(excerpts[0]).filter(([key]) => key !== "plaintext")
    );
    expect(() => decodeRunSnapshot(createRun([missingPlaintext]), "run-1")).toThrow();

    // Validation of plaintext_bytes (safe integer required)
    const invalidPlaintextBytes = ["invalid", 1.5, null, -1, NaN];
    for (const invalidBytes of invalidPlaintextBytes) {
      expect(() =>
        decodeRunSnapshot(
          createRun([{ ...excerpts[0], plaintext_bytes: invalidBytes }]),
          "run-1"
        )
      ).toThrow();
    }

    // User question regression check: semantic restrictions remain active for user questions
    expect(() =>
      decodeUserQuestionRequest({
        kind: "short_text",
        prompt: "Please provide your password",
      })
    ).toThrow();
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

describe("WS inbound decoder ceilings and envelopes (Phase 03)", () => {
  it("decodes a synthetic 117-session sessions.list response (~67 KB) that previously hung", () => {
    const sessions = Array.from({ length: 117 }, (_, i) => ({
      id: `sess-${i.toString().padStart(4, "0")}`,
      title: `Long session title number ${i} testing boundary limits and pagination `.repeat(8),
      created_at: 1_700_000_000_000 + i * 1000,
      updated_at: 1_700_000_000_000 + i * 1000,
    }));
    const raw = JSON.stringify({
      type: "res",
      version: "v1",
      id: "req-sessions-117",
      ok: true,
      data: { sessions },
    });
    const byteLen = new TextEncoder().encode(raw).byteLength;
    expect(byteLen).toBeGreaterThan(64 * 1024);
    expect(byteLen).toBeLessThan(MAX_WS_RESPONSE_FRAME_BYTES);

    const inbound = decodeWsInbound(raw);
    expect(inbound.kind).toBe("frame");
    if (inbound.kind === "frame" && inbound.frame.type === "res") {
      expect(inbound.frame.id).toBe("req-sessions-117");
    }
    const frameJson = decodeWsFrameJson(raw);
    expect(frameJson).toBeDefined();
    if (frameJson?.type === "res") {
      expect(frameJson.id).toBe("req-sessions-117");
    }
  });

  it("decodes response at exactly 8 MiB bytes and rejects 8 MiB + 1 as undecodable", () => {
    const prefix = '{"type":"res","version":"v1","id":"req-exact-8m","ok":true,"data":"';
    const suffix = '"}';
    const padLen = MAX_WS_RESPONSE_FRAME_BYTES - (prefix.length + suffix.length);
    const rawExact = prefix + "a".repeat(padLen) + suffix;
    const exactBytes = new TextEncoder().encode(rawExact).byteLength;
    expect(exactBytes).toBe(MAX_WS_RESPONSE_FRAME_BYTES);

    const inboundExact = decodeWsInbound(rawExact);
    expect(inboundExact.kind).toBe("frame");
    expect(decodeWsFrameJson(rawExact)).toBeDefined();

    // +1 byte exceeds response ceiling
    const rawPlusOne = prefix + "a".repeat(padLen + 1) + suffix;
    const plusOneBytes = new TextEncoder().encode(rawPlusOne).byteLength;
    expect(plusOneBytes).toBe(MAX_WS_RESPONSE_FRAME_BYTES + 1);

    const inboundPlusOne = decodeWsInbound(rawPlusOne);
    expect(inboundPlusOne.kind).toBe("undecodable");
    expect(decodeWsFrameJson(rawPlusOne)).toBeUndefined();
  });

  it("rejects string where UTF-16 length < 8 MiB but UTF-8 byte length > 8 MiB", () => {
    const prefix = '{"type":"res","version":"v1","id":"req-multibyte","ok":true,"data":"';
    const suffix = '"}';
    // 'é' is 1 UTF-16 code unit (char) but 2 UTF-8 bytes.
    // 4.5 million 'é' characters = 4.5M UTF-16 length, 9M UTF-8 bytes (> 8 MiB).
    const charCount = 4.5 * 1024 * 1024;
    const rawMultibyte = prefix + "é".repeat(charCount) + suffix;
    expect(rawMultibyte.length).toBeLessThan(MAX_WS_RESPONSE_FRAME_BYTES);

    const result = decodeWsInbound(rawMultibyte);
    expect(result.kind).toBe("undecodable");
    expect(decodeWsFrameJson(rawMultibyte)).toBeUndefined();
  });

  it("decodes event at exactly 64 KiB bytes and classifies 64 KiB + 1 as invalid_event", () => {
    const prefix = '{"type":"event","version":"v1","event":"run.delta","payload":{"text":"';
    const suffix = '"}}';
    const exactPadLen = MAX_WS_EVENT_FRAME_BYTES - (prefix.length + suffix.length);
    const rawExactEvent = prefix + "x".repeat(exactPadLen) + suffix;
    const exactBytes = new TextEncoder().encode(rawExactEvent).byteLength;
    expect(exactBytes).toBe(MAX_WS_EVENT_FRAME_BYTES);

    const exactResult = decodeWsInbound(rawExactEvent);
    expect(exactResult.kind).toBe("frame");
    expect(decodeWsFrameJson(rawExactEvent)).toBeDefined();

    const rawOversizedEvent = prefix + "x".repeat(exactPadLen + 1) + suffix;
    const oversizedBytes = new TextEncoder().encode(rawOversizedEvent).byteLength;
    expect(oversizedBytes).toBe(MAX_WS_EVENT_FRAME_BYTES + 1);

    const oversizedResult = decodeWsInbound(rawOversizedEvent);
    expect(oversizedResult.kind).toBe("invalid_event");
    if (oversizedResult.kind === "invalid_event") {
      expect(oversizedResult.event).toBe("run.delta");
    }
    expect(decodeWsFrameJson(rawOversizedEvent)).toBeUndefined();
  });

  it("decodes daemon error envelope with code, message, request_id, and details", () => {
    const raw = JSON.stringify({
      type: "res",
      version: "v1",
      id: "req-err-1",
      ok: false,
      error: {
        code: "invalid_cursor",
        message: "Invalid cursor token",
        request_id: "req-err-1",
        details: { expected: "base64url", received: "???" },
      },
    });
    const inbound = decodeWsInbound(raw);
    expect(inbound.kind).toBe("frame");
    if (inbound.kind === "frame" && inbound.frame.type === "res") {
      expect(inbound.frame.ok).toBe(false);
      expect(inbound.frame.error?.code).toBe("invalid_cursor");
      expect(inbound.frame.error?.message).toBe("Invalid cursor token");
    }
    expect(decodeWsFrameJson(raw)).toBeDefined();
  });

  it("returns invalid_response when res has valid id but invalid envelope or unexpected keys", () => {
    const rawWithExtraKey = JSON.stringify({
      type: "res",
      version: "v1",
      id: "req-extra-key",
      ok: false,
      error: {
        code: "bad",
        message: "Bad",
        unknown_key_here: true,
      },
    });
    const result = decodeWsInbound(rawWithExtraKey);
    expect(result).toEqual({ kind: "invalid_response", id: "req-extra-key" });
    expect(decodeWsFrameJson(rawWithExtraKey)).toBeUndefined();
  });

  it("returns undecodable when res lacks trustworthy id", () => {
    const rawNoId = JSON.stringify({
      type: "res",
      version: "v1",
      ok: true,
      data: {},
    });
    expect(decodeWsInbound(rawNoId)).toEqual({ kind: "undecodable" });

    const rawEmptyId = JSON.stringify({
      type: "res",
      version: "v1",
      id: "",
      ok: true,
    });
    expect(decodeWsInbound(rawEmptyId)).toEqual({ kind: "undecodable" });

    const rawHugeId = JSON.stringify({
      type: "res",
      version: "v1",
      id: "a".repeat(257),
      ok: true,
    });
    expect(decodeWsInbound(rawHugeId)).toEqual({ kind: "undecodable" });
  });

  it("returns unsupported for record with unknown type for forward compatibility", () => {
    const rawUnknown = JSON.stringify({
      type: "custom_future_type",
      version: "v2",
      payload: { foo: "bar" },
    });
    expect(decodeWsInbound(rawUnknown)).toEqual({ kind: "unsupported" });
    expect(decodeWsFrameJson(rawUnknown)).toBeUndefined();
  });

  it("returns undecodable for non-string or non-JSON payloads", () => {
    expect(decodeWsInbound(null)).toEqual({ kind: "undecodable" });
    expect(decodeWsInbound(12345)).toEqual({ kind: "undecodable" });
    expect(decodeWsInbound("not-json")).toEqual({ kind: "undecodable" });
    expect(decodeWsInbound("")).toEqual({ kind: "undecodable" });
  });
});
