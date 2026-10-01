import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRunAdapter } from "./HttpRunAdapter.js";

afterEach(() => vi.unstubAllGlobals());

describe("HttpRunAdapter", () => {
  it("bounds list requests, encodes cursors and session_id, and defaults to metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ schema_version: 1, runs: [] }) });
    vi.stubGlobal("fetch", fetch);
    await new HttpRunAdapter("http://daemon").list({
      cursor: "opaque + cursor",
      limit: 999,
      sessionId: "session/a",
    });
    expect(fetch.mock.calls[0][0]).toContain("limit=100");
    expect(fetch.mock.calls[0][0]).toContain("cursor=opaque+%2B+cursor");
    expect(fetch.mock.calls[0][0]).toContain("session_id=session%2Fa");
    await new HttpRunAdapter("http://daemon").get("run/a");
    expect(fetch.mock.calls[1][0]).not.toContain("include_debug");
  });
  it("requires an injected capability for debug, passes cursors, and omits debug cursor when debug disabled", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    const authAdapter = new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:read:debug"]),
      authToken: "secret",
    });
    await authAdapter.get("run", {
      includeDebug: true,
      debugCursor: "dbg+cursor",
      eventCursor: "evt+cursor",
      toolCursor: "tool+cursor",
      lineageCursor: "lin+cursor",
    });
    expect(fetch.mock.calls[0][0]).toContain("include_debug=true");
    expect(fetch.mock.calls[0][0]).toContain("debug_cursor=dbg%2Bcursor");
    expect(fetch.mock.calls[0][0]).toContain("event_cursor=evt%2Bcursor");
    expect(fetch.mock.calls[0][0]).toContain("tool_cursor=tool%2Bcursor");
    expect(fetch.mock.calls[0][0]).toContain("lineage_cursor=lin%2Bcursor");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer secret");

    // When includeDebug is false, debug_cursor must be rejected/omitted even if capability is present
    await authAdapter.get("run", {
      includeDebug: false,
      debugCursor: "dbg+cursor",
      eventCursor: "evt+cursor",
    });
    expect(fetch.mock.calls[1][0]).not.toContain("include_debug");
    expect(fetch.mock.calls[1][0]).not.toContain("debug_cursor");
    expect(fetch.mock.calls[1][0]).toContain("event_cursor=evt%2Bcursor");

    // Without debug capability, include_debug and debug_cursor must be omitted
    await new HttpRunAdapter("http://daemon").get("run", {
      includeDebug: true,
      debugCursor: "dbg+cursor",
    });
    expect(fetch.mock.calls[2][0]).not.toContain("include_debug");
    expect(fetch.mock.calls[2][0]).not.toContain("debug_cursor");
  });
  it("preserves generic status for UI clearing and denies unavailable mutations", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    await expect(new HttpRunAdapter("http://daemon").get("run")).rejects.toMatchObject({
      status: 403,
    });
    await expect(new HttpRunAdapter("http://daemon").export("run")).rejects.toThrow("unavailable");
    await expect(new HttpRunAdapter("http://daemon").delete("run")).rejects.toThrow("unavailable");
  });

  it("uses authenticated encoded export and DELETE requests, including empty DELETE success", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(["export"]) })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:export", "run:delete"]),
      authToken: "secret",
    });

    await expect(adapter.export("run/a")).resolves.toBeInstanceOf(Blob);
    await expect(adapter.delete("run/a")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("http://daemon/v1/runs/run%2Fa/export");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer secret");
    expect(fetch.mock.calls[1][0]).toBe("http://daemon/v1/runs/run%2Fa");
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("requests run tree with encoded root_session_id and passes signal", async () => {
    const sampleNodes = [{ id: "node-1", root_session_id: "sess/1" }];
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleNodes,
    });
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon", { authToken: "secret" });
    const controller = new AbortController();
    const nodes = await adapter.getRunTree("sess/1", controller.signal);
    expect(nodes).toEqual(sampleNodes);
    expect(fetch.mock.calls[0][0]).toBe("http://daemon/v1/run-trees/sess%2F1");
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it("decodes valid diagnostics and drops malformed optional diagnostics on events", async () => {
    const rawSnapshot = {
      schema_version: 1,
      run: { run_id: "run-1", snapshot_seq: 1 },
      events: [
        {
          event_id: "evt-1",
          event_seq: 1,
          event_kind: "tool_selection",
          tool_selection: {
            schema_version: "tool_selection.v1",
            selected_total: 1,
            order_hash: "a1b2c3d4",
            reason_counts: { global_selected: 1 },
            selected_tools: [{ canonical_name: "tool_a", reason_code: "global_selected" }],
            rejected_tools: [],
          },
          memory_outcome: {
            schema_version: "memory_outcome.v1",
            operation_id: "op-1",
            operation_kind: "episode_flush",
            state: "stored",
            reason: "stored",
          },
          request_provenance: {
            schema_version: "request_provenance.v1",
            logical_request_id: "req-1",
            provider_id: "prov-1",
            model: "model-1",
            prompt_format_version: "v1",
            section_summaries: [],
          },
          task_outcome: {
            schema_version: "task_outcome.v1",
            task_id: "task-1",
            checker_id: "checker-1",
            checker_version: "v1",
            artifact_path: "path.json",
            artifact_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status: "passed",
            reason: "valid",
            evaluated_at_ms: 1000,
          },
        },
        {
          event_id: "evt-2",
          event_seq: 2,
          event_kind: "tool_selection",
          tool_selection: {
            schema_version: "tool_selection.v1",
            raw_prompt: "illegal",
            order_hash: 12345,
          },
          memory_outcome: {
            schema_version: "memory_outcome.v1",
            operation_id: "op-2",
            operation_kind: "episode_flush",
            state: "INVALID_STATE",
            reason: "stored",
          },
          task_outcome: {
            schema_version: "task_outcome.v2",
            status: "passed",
          },
        },
      ],
      tool_calls: [],
      memory_lineage: [],
    };
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => rawSnapshot,
    });
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon");
    const snapshot = await adapter.get("run-1");

    expect(snapshot.events[0].tool_selection?.selected_tools?.[0].canonical_name).toBe("tool_a");
    expect(snapshot.events[0].memory_outcome?.state).toBe("stored");
    expect(snapshot.events[0].request_provenance?.model).toBe("model-1");
    expect(snapshot.events[0].task_outcome?.status).toBe("passed");

    expect(snapshot.events[1].tool_selection).toBeUndefined();
    expect(snapshot.events[1].memory_outcome).toBeUndefined();
    expect(snapshot.events[1].task_outcome).toBeUndefined();
  });

  it("exports exact committed content and every advertised tool/event/debug page, omitting expired reasoning", async () => {
    const base = {
      schema_version: 1,
      run: { run_id: "run-1", session_id: "session-1", trace_id: "trace-1", lifecycle_status: "completed", provider_id: "local", started_at_ms: 1, snapshot_seq: 2, redaction: { debug_available: true } },
      events: [],
      tool_calls: [],
      memory_lineage: [],
    };
    const excerpt = (excerpt_seq: number, plaintext: string, expires_at_ms: number) => ({
      excerpt_seq, plaintext, expires_at_ms, kind: "provider_reasoning", created_at_ms: 1,
      plaintext_bytes: plaintext.length, truncated: false, redaction_count: 0,
    });
    const fetch = vi.fn((url: string) => {
      const query = new URL(url).searchParams;
      let body: unknown;
      if (url.includes("/export?")) body = {
        ...base,
        transcript: {
          messages: [
            { role: "user", content: "Tìm kiếm chính xác" },
            { role: "assistant", content: "", tool_calls: [{ id: "call-1", name: "web_search", arguments: { query: "evidence" } }] },
            { role: "tool", tool_call_id: "call-1", content: '{"status":"failed","output":"upstream unavailable"}' },
            { role: "assistant", content: "Cannot verify the result." },
          ],
          truncated: false,
        },
        debug_excerpts: [excerpt(1, "EXPIRED_SECRET", 0)],
        next_event_cursor: "e2", next_tool_cursor: "t2", next_debug_cursor: "d2",
      };
      else if (query.has("event_cursor")) body = {
        ...base, events: [{ event_id: "event-2", event_seq: 2, event_kind: "run.completed", occurred_at_ms: 5 }],
      };
      else if (query.has("tool_cursor")) body = {
        ...base, tool_calls: [{ tool_call_id: "call-1", ordinal: 0, tool_name: "web_search", status: "failed", started_at_ms: 2, completed_at_ms: 3 }],
      };
      else body = { ...base, debug_excerpts: [excerpt(2, "RECORDED_THOUGHT", Number.MAX_SAFE_INTEGER)] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);
    const text = await (await new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:export", "run:read:debug"]),
    }).exportText("run-1")).text();
    expect(text).toContain("Session ID: session-1");
    expect(text).toContain("Tìm kiếm chính xác");
    expect(text).toContain("Cannot verify the result.");
    expect(text).toContain('{"status":"failed","output":"upstream unavailable"}');
    expect(text).toContain("Tool: web_search · ID: call-1");
    expect(text).toContain("Recorded status: failed");
    expect(text).toContain('"event_id": "event-2"');
    expect(text).toContain("RECORDED_THOUGHT");
    expect(text).not.toContain("EXPIRED_SECRET");
    expect(text).toContain("Expired debug excerpts omitted");
  });

  it("does not request or include debug without capability and discloses unavailable/truncated text", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schema_version: 1,
      run: { run_id: "run-1", session_id: "session-1", redaction: {} },
      events: [], tool_calls: [], memory_lineage: [],
      transcript: { messages: [], unavailable_reason: "committed run correlation missing", truncated: true },
      debug_excerpts: [{ kind: "provider_reasoning", plaintext: "UNAUTHORIZED_SECRET", expires_at_ms: Number.MAX_SAFE_INTEGER }],
      next_debug_cursor: "secret-page",
    })));
    vi.stubGlobal("fetch", fetch);
    const text = await (await new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:export"]),
    }).exportText("run-1")).text();
    expect(text).toContain("Transcript unavailable: committed run correlation missing");
    expect(text).toContain("TRUNCATED: committed transcript");
    expect(text).toContain("Debug unavailable: not authorized");
    expect(text).toContain("Provider reasoning unavailable");
    expect(text).not.toContain("UNAUTHORIZED_SECRET");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).not.toContain("include_debug");
  });

  it("discloses repeated pagination cursors and rejects cross-run continuation content", async () => {
    const base = {
      schema_version: 1, run: { run_id: "run-1", session_id: "session-1", redaction: {} },
      events: [], tool_calls: [], memory_lineage: [], next_tool_cursor: "repeated",
    };
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(base))));
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon", { capabilities: new Set(["run:export"]) });
    const text = await (await adapter.exportText("run-1")).text();
    expect(text).toContain("TRUNCATED: tools pagination");
    expect(text).toContain("repeated server cursor");
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify(base)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...base, run: { ...base.run, run_id: "other-run" } })));
    await expect(adapter.exportText("run-1")).rejects.toThrow("correlation mismatch");
  });
});
