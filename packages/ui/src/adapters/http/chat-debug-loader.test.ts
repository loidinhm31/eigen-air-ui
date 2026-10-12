import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto } from "@eigen-air-ui/shared/types";
import { HttpRunAdapter } from "./HttpRunAdapter.js";
import {
  loadHistoricalDebug,
  MAX_DEBUG_PAGES,
  MAX_ROW_PLAINTEXT_BYTES,
  MAX_RUN_DEBUG_BYTES,
  UTF8_ENCODER,
} from "./chat-debug-loader.js";

afterEach(() => vi.unstubAllGlobals());

function makeMockSnapshot(overrides: Partial<RunSnapshotDto> = {}): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: "run-1",
      trace_id: "trace-1",
      session_id: "sess-1",
      root_run_id: "run-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "ws-1",
      agent_id: "agent-1",
      provider_id: "ollama-local",
      channel: "ws",
      lifecycle_status: "completed",
      started_at_ms: 1000,
      updated_at_ms: 2000,
      completed_at_ms: 2000,
      snapshot_seq: 1,
      correlation_state: "correlated",
      redaction: {
        metadata_only: false,
        debug_requested: true,
        debug_available: true,
        unavailable_reason: null,
      },
    },
    events: [
      {
        event_id: "evt-1",
        event_seq: 1,
        event_kind: "request_sent",
        occurred_at_ms: 1100,
        request_provenance: {
          schema_version: "request_provenance.v1",
          logical_request_id: "req-1",
          provider_id: "ollama-local",
          model: "gemma-4-it",
          prompt_format_version: "v1",
          section_summaries: [],
        },
      },
    ],
    tool_calls: [],
    memory_lineage: [],
    debug_excerpts: [
      {
        excerpt_seq: 1,
        kind: "system_prompt",
        plaintext: "You are a helpful assistant.",
        plaintext_bytes: 28,
        created_at_ms: 1050,
        expires_at_ms: 100000,
        truncated: false,
        redaction_count: 0,
      },
      {
        excerpt_seq: 2,
        kind: "provider_reasoning",
        plaintext: "Thinking about the answer...",
        plaintext_bytes: 28,
        created_at_ms: 1150,
        expires_at_ms: 100000,
        truncated: false,
        redaction_count: 0,
      },
    ],
    next_debug_cursor: null,
    ...overrides,
  };
}

describe("ChatDebugLoader", () => {
  it("projects single-page debug excerpts with model provenance and earliest expiry", async () => {
    const adapter = {
      get: vi.fn().mockResolvedValue(makeMockSnapshot()),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.runId).toBe("run-1");
      expect(result.provider).toBe("ollama-local");
      expect(result.model).toBe("gemma-4-it");
      expect(result.systemPrompt).toBe("You are a helpful assistant.");
      expect(result.reasoning?.available).toBe(true);
      expect(result.reasoning?.text).toBe("Thinking about the answer...");
      expect(result.reasoning?.truncated).toBe(false);
      expect(result.expiresAtMs).toBe(100000);
      expect(result.isPartial).toBe(false);
    }
  });

  it("pages through multiple pages following next_debug_cursor and deduplicates by excerpt_seq", async () => {
    const page1 = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "System prompt page 1",
          plaintext_bytes: 20,
          created_at_ms: 1050,
          expires_at_ms: 90000,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "cursor-page-2",
    });
    const page2 = makeMockSnapshot({
      debug_excerpts: [
        // Duplicate seq 1 should be ignored
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "Duplicate",
          plaintext_bytes: 9,
          created_at_ms: 1050,
          expires_at_ms: 90000,
          truncated: false,
          redaction_count: 0,
        },
        {
          excerpt_seq: 2,
          kind: "provider_reasoning",
          plaintext: "Reasoning page 2",
          plaintext_bytes: 16,
          created_at_ms: 1150,
          expires_at_ms: 80000,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: null,
    });

    const adapter = {
      get: vi.fn()
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.systemPrompt).toBe("System prompt page 1");
      expect(result.reasoning?.text).toBe("Reasoning page 2");
      expect(result.expiresAtMs).toBe(80000);
      expect(result.isPartial).toBe(false);
    }
  });

  it("detects cursor loops and ends paging as partial evidence", async () => {
    const page1 = makeMockSnapshot({
      next_debug_cursor: "loop-cursor",
    });
    const page2 = makeMockSnapshot({
      next_debug_cursor: "loop-cursor",
    });

    const adapter = {
      get: vi.fn()
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.isPartial).toBe(true);
    }
  });

  it("caps paging at MAX_DEBUG_PAGES (16) and marks isPartial true", async () => {
    const adapter = {
      get: vi.fn().mockImplementation((_runId, opts) => {
        const cursorNum = opts?.debugCursor ? parseInt(opts.debugCursor.split("-")[1], 10) : 0;
        return Promise.resolve(
          makeMockSnapshot({
            debug_excerpts: [
              {
                excerpt_seq: cursorNum + 1,
                kind: "provider_reasoning",
                plaintext: `Step ${cursorNum + 1}`,
                plaintext_bytes: `Step ${cursorNum + 1}`.length,
                created_at_ms: 1000,
                expires_at_ms: 50000,
                truncated: false,
                redaction_count: 0,
              },
            ],
            next_debug_cursor: `cursor-${cursorNum + 1}`,
          })
        );
      }),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(adapter.get).toHaveBeenCalledTimes(MAX_DEBUG_PAGES);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.isPartial).toBe(true);
    }
  });

  it("rejects malformed declared byte length", async () => {
    const badSnapshot = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "Real text has 17 B",
          plaintext_bytes: 999, // Mismatched declared byte length
          created_at_ms: 1000,
          expires_at_ms: 50000,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });

    const adapter = {
      get: vi.fn().mockResolvedValue(badSnapshot),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("invalid");
    }
  });

  it("preserves exact plaintext bytes through REST JSON escaping and decoding", async () => {
    const text = 'Quotes "hello", slash \\, CRLF\r\nand Unicode Tiếng Việt 日本語';
    const actual = UTF8_ENCODER.encode(text).byteLength;
    const snapshot = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: text,
          plaintext_bytes: actual,
          created_at_ms: 1000,
          expires_at_ms: 50000,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });

    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)));
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:read:debug"]),
    });

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 5000,
    });

    expect(fetch.mock.calls[0][0]).toBe("http://daemon/v1/runs/run-1?include_debug=true");
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.systemPrompt).toBe(text);
      expect(result.plaintextBytes).toBe(actual);
    }
  });

  it.each([-1, 1, 4])("rejects a declared byte discrepancy of %i without tolerance", async (delta) => {
    const snapshot = makeMockSnapshot();
    const excerpt = snapshot.debug_excerpts![0];
    snapshot.debug_excerpts = [{
      ...excerpt,
      plaintext_bytes: UTF8_ENCODER.encode(excerpt.plaintext).byteLength + delta,
    }];
    const adapter = {
      get: vi.fn().mockResolvedValue(snapshot),
    } as unknown as HttpRunAdapter;

    await expect(loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 5000,
    })).resolves.toEqual({ status: "unavailable", runId: "run-1", reason: "invalid" });
  });

  it("enforces row byte ceiling (MAX_ROW_PLAINTEXT_BYTES = 16 KiB)", async () => {
    const oversized = "x".repeat(MAX_ROW_PLAINTEXT_BYTES + 1);
    const badSnapshot = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: oversized,
          plaintext_bytes: oversized.length,
          created_at_ms: 1000,
          expires_at_ms: 50000,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });

    const adapter = {
      get: vi.fn().mockResolvedValue(badSnapshot),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("invalid");
    }
  });

  it("caps aggregate bytes at MAX_RUN_DEBUG_BYTES (64 KiB) and marks isPartial true", async () => {
    const chunk = "a".repeat(16 * 1024); // 16 KiB
    const snapshots = [1, 2, 3, 4, 5].map((idx) =>
      makeMockSnapshot({
        debug_excerpts: [
          {
            excerpt_seq: idx,
            kind: "provider_reasoning",
            plaintext: chunk,
            plaintext_bytes: chunk.length,
            created_at_ms: 1000,
            expires_at_ms: 50000,
            truncated: false,
            redaction_count: 0,
          },
        ],
        next_debug_cursor: idx < 5 ? `cursor-${idx}` : null,
      })
    );

    let callCount = 0;
    const adapter = {
      get: vi.fn().mockImplementation(() => {
        const snap = snapshots[callCount];
        callCount += 1;
        return Promise.resolve(snap);
      }),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.isPartial).toBe(true);
      expect(result.plaintextBytes).toBeLessThanOrEqual(MAX_RUN_DEBUG_BYTES);
    }
  });

  it("filters expired excerpts and returns unavailable (expired) if none remain", async () => {
    const expiredSnapshot = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "Old prompt",
          plaintext_bytes: 10,
          created_at_ms: 1000,
          expires_at_ms: 5000, // Expired relative to now = 6000
          truncated: false,
          redaction_count: 0,
        },
      ],
    });

    const adapter = {
      get: vi.fn().mockResolvedValue(expiredSnapshot),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 6000,
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("expired");
    }
  });

  it("maps 401/403/404 HTTP errors to honest unavailable states", async () => {
    const authError = new Error("Denied");
    Object.assign(authError, { status: 401 });

    const adapterAuth = {
      get: vi.fn().mockRejectedValue(authError),
    } as unknown as HttpRunAdapter;

    const resAuth = await loadHistoricalDebug({
      adapter: adapterAuth,
      runId: "run-1",
      sessionId: "sess-1",
    });
    expect(resAuth.status).toBe("unavailable");
    if (resAuth.status === "unavailable") expect(resAuth.reason).toBe("unauthorized");

    const notFoundError = new Error("Missing");
    Object.assign(notFoundError, { status: 404 });

    const adapterNotFound = {
      get: vi.fn().mockRejectedValue(notFoundError),
    } as unknown as HttpRunAdapter;

    const resNotFound = await loadHistoricalDebug({
      adapter: adapterNotFound,
      runId: "run-1",
      sessionId: "sess-1",
    });
    expect(resNotFound.status).toBe("unavailable");
    if (resNotFound.status === "unavailable") expect(resNotFound.reason).toBe("not_found");
  });

  it("maps 503 and network errors to retryable error state", async () => {
    const netError = new TypeError("Failed to fetch");

    const adapter = {
      get: vi.fn().mockRejectedValue(netError),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.retryable).toBe(true);
      expect(result.message).toContain("Failed to fetch");
    }
  });

  it("preserves safe rows on continuation 503 error as partial evidence", async () => {
    const page1 = makeMockSnapshot({
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "Valid page 1 prompt",
          plaintext_bytes: 19,
          created_at_ms: 1000,
          expires_at_ms: 50000,
          truncated: false,
          redaction_count: 0,
        },
      ],
      next_debug_cursor: "page-2",
    });

    const error503 = new Error("Service Unavailable");
    Object.assign(error503, { status: 503 });

    const adapter = {
      get: vi.fn()
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(error503),
    } as unknown as HttpRunAdapter;

    const result = await loadHistoricalDebug({
      adapter,
      runId: "run-1",
      sessionId: "sess-1",
      now: 2000,
    });

    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.systemPrompt).toBe("Valid page 1 prompt");
      expect(result.isPartial).toBe(true);
    }
  });

  it("aborts when signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const adapter = {
      get: vi.fn().mockResolvedValue(makeMockSnapshot()),
    } as unknown as HttpRunAdapter;

    await expect(
      loadHistoricalDebug({
        adapter,
        runId: "run-1",
        sessionId: "sess-1",
        signal: controller.signal,
      })
    ).rejects.toThrow("aborted");
  });
});
