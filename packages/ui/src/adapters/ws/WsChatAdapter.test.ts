import { describe, expect, it, vi } from "vitest";

const wsHarness = vi.hoisted(() => {
  const harness = {
    nextResponse: undefined as unknown,
    responses: [] as unknown[],
    sent: [] as Array<{ method: string; params: unknown; options?: unknown }>,
    disconnectedCount: 0,
    connectedCount: 0,
    reconnectHandler: undefined as ((fence?: unknown) => Promise<void>) | undefined,
    client: undefined as FakeWsClient | undefined,
    reset() {
      this.nextResponse = undefined;
      this.responses = [];
      this.sent = [];
      this.disconnectedCount = 0;
      this.connectedCount = 0;
      this.reconnectHandler = undefined;
    },
  };
  class FakeWsClient {
    readonly url: string;
    private handlers: Array<(event: unknown) => void> = [];

    constructor(url: string) {
      this.url = url;
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
    private invalidImageHintHandlers: Array<() => void> = [];
    onInvalidImageHint(handler: () => void) {
      this.invalidImageHintHandlers.push(handler);
    }
    emitInvalidImageHint() {
      this.invalidImageHintHandlers.forEach((handler) => handler());
    }
    onReconnect(handler: (fence?: unknown) => Promise<void>) {
      harness.reconnectHandler = handler;
    }
    disconnect() {
      harness.disconnectedCount++;
    }
    async connect() {
      harness.connectedCount++;
    }

    async send(method: string, params: unknown, options?: unknown) {
      harness.sent.push({ method, params, options });
      if (harness.responses.length > 0) {
        return harness.responses.shift();
      }
      return harness.nextResponse;
    }

    emit(event: unknown) {
      this.handlers.forEach((handler) => handler(event));
    }
  }
  return { harness, FakeWsClient };
});

vi.mock("./WsClient.js", () => ({ WsClient: wsHarness.FakeWsClient }));
import {
  WsChatAdapter,
  buildChatSendParams,
  buildDebugRequest,
  projectRunCorrelation,
} from "./WsChatAdapter.js";
import { isWsRequestError } from "./ws-request-error.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";



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

  it("passes through exact selected skill identity transport fields", () => {
    const selectedSkillId = "qwen-image-local";
    const selectedSkillInstallId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const selectedSkillContentRevision = "a".repeat(64);

    expect(
      buildChatSendParams("generate an image", undefined, {
        selectedSkillId,
        selectedSkillInstallId,
        selectedSkillContentRevision,
      })
    ).toEqual({
      message: "generate an image",
      stream: true,
      selected_skill_id: selectedSkillId,
      selected_skill_install_id: selectedSkillInstallId,
      selected_skill_content_revision: selectedSkillContentRevision,
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

describe("WsChatAdapter auth and connection lifecycle", () => {
  it("sends connect params with token when provider supplies token and resolves session", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("resolved-session");
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws", () => ({
      authToken: "ws-sentinel-token",
    }));

    wsHarness.harness.responses = [
      {
        ok: true,
        data: {
          session_id: "resolved-session",
          agent: "default",
          version: "v1",
        },
      },
      {
        ok: true,
        data: {
          session: { id: "resolved-session" },
        },
      },
    ];

    const result = await adapter.connect();
    expect(result.session_id).toBe("resolved-session");
    expect(result.version).toBe("v1");
    expect(wsHarness.harness.connectedCount).toBe(1);
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "connect",
      params: { token: "ws-sentinel-token" },
      options: { fence: undefined },
    });
    expect(wsHarness.harness.client?.url).toBe("ws://localhost:18790/ws");
    expect(wsHarness.harness.client?.url).not.toContain("ws-sentinel-token");
  });

  it("sends empty params when no token is supplied by provider", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("default-session");
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      {
        ok: true,
        data: {
          session_id: "default-session",
          agent: "default",
          version: "v1",
        },
      },
      {
        ok: true,
        data: {
          session: { id: "default-session" },
        },
      },
    ];

    await adapter.connect();
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "connect",
      params: {},
      options: { fence: undefined },
    });
  });

  it("supports explicit connect token overriding provider", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("default-session");
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws", () => ({
      authToken: "provider-token",
    }));

    wsHarness.harness.responses = [
      {
        ok: true,
        data: {
          session_id: "default-session",
          agent: "default",
          version: "v1",
        },
      },
      {
        ok: true,
        data: {
          session: { id: "default-session" },
        },
      },
    ];

    await adapter.connect("explicit-override-token");
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "connect",
      params: { token: "explicit-override-token" },
      options: { fence: undefined },
    });
  });

  it("disconnects socket and rejects on failed connect response", async () => {
    wsHarness.harness.reset();
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws", () => ({
      authToken: "invalid-token",
    }));

    wsHarness.harness.responses = [
      {
        ok: false,
        error: { message: "unauthorized" },
      },
    ];

    await expect(adapter.connect()).rejects.toThrow("unauthorized");
    expect(wsHarness.harness.disconnectedCount).toBe(1);
  });

  it("reads rotated token from access provider on reconnect", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("sess-1");
    let currentToken = "token-alpha";
    const { WsChatAdapter } = await import("./WsChatAdapter.js");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws", () => ({
      authToken: currentToken,
    }));

    wsHarness.harness.responses = [
      {
        ok: true,
        data: { session_id: "sess-1", agent: "default", version: "v1" },
      },
      {
        ok: true,
        data: { session: { id: "sess-1" } },
      },
    ];
    await adapter.connect();
    expect(wsHarness.harness.sent[0].params).toEqual({ token: "token-alpha" });

    // Rotate token
    currentToken = "token-beta";
    wsHarness.harness.sent = [];
    wsHarness.harness.responses = [
      {
        ok: true,
        data: { session_id: "sess-1", agent: "default", version: "v1" },
      },
      {
        ok: true,
        data: { session: { id: "sess-1" } },
      },
    ];

    expect(wsHarness.harness.reconnectHandler).toBeDefined();
    await wsHarness.harness.reconnectHandler!({ signal: { aborted: false } });

    expect(wsHarness.harness.sent[0]).toEqual({
      method: "connect",
      params: { token: "token-beta" },
      options: { fence: { signal: { aborted: false } } },
    });
  });
});


describe("WsChatAdapter image hints", () => {
  const jobHint = {
    type: "event",
    version: "v1",
    event: "image_job.updated",
    session_id: "session-synth-001",
    run_id: "run-synth-001",
    payload: {
      job_id: "00000000-0000-4000-8000-000000000001",
      session_id: "session-synth-001",
      run_id: "run-synth-001",
      state: "running",
      revision: 3,
      requested_count: 2,
      completed_count: 0,
    },
  };
  const artifactHint = {
    type: "event",
    version: "v1",
    event: "image_artifact.committed",
    session_id: "session-synth-001",
    run_id: "run-synth-001",
    payload: {
      artifact_id: "10000000-0000-4000-8000-000000000001",
      job_id: "00000000-0000-4000-8000-000000000001",
      ordinal: 0,
      state: "committed",
      revision: 1,
    },
  };

  it("dispatches decoded hints and invalid signals, supports unsubscribe, leaves other events alone", () => {
    const adapter = new WsChatAdapter("ws://daemon");
    const hints: unknown[] = [];
    const runSignals: Array<{ event: string }> = [];
    const reconnects: number[] = [];
    adapter.subscribeRunCorrelation((signal) => runSignals.push(signal));
    adapter.onRunReconnect(() => reconnects.push(1));
    const unsubscribe = adapter.onImageHint((hint) => hints.push(hint));

    wsHarness.harness.client?.emit(jobHint);
    wsHarness.harness.client?.emit(artifactHint);
    wsHarness.harness.client?.emitInvalidImageHint();
    expect(hints).toEqual([jobHint, artifactHint, { invalid: true }]);

    // Hints are not run lifecycle events: no run correlation, no reconnect side effects.
    expect(runSignals).toEqual([]);
    expect(reconnects).toEqual([]);

    wsHarness.harness.client?.emit({
      type: "event",
      version: "v1",
      event: "run.finished",
      run_id: "run-synth-001",
      payload: {},
    });
    expect(runSignals.map((signal) => signal.event)).toEqual(["run.finished"]);
    expect(hints).toHaveLength(3);

    unsubscribe();
    wsHarness.harness.client?.emit(jobHint);
    wsHarness.harness.client?.emitInvalidImageHint();
    expect(hints).toHaveLength(3);
  });

  it("isolates a throwing subscriber: later subscribers still receive, the stream keeps running", () => {
    const adapter = new WsChatAdapter("ws://daemon");
    const received: unknown[] = [];
    const runSignals: Array<{ event: string }> = [];
    adapter.subscribeRunCorrelation((signal) => runSignals.push(signal));
    adapter.onImageHint(() => {
      throw new Error("subscriber boom");
    });
    adapter.onImageHint((hint) => received.push(hint));
    const client = wsHarness.harness.client;

    expect(() => client?.emit(jobHint)).not.toThrow();
    expect(() => client?.emitInvalidImageHint()).not.toThrow();
    expect(received).toEqual([jobHint, { invalid: true }]);

    // Later frames are still processed after the throwing subscriber.
    expect(() => client?.emit(artifactHint)).not.toThrow();
    client?.emit({
      type: "event",
      version: "v1",
      event: "run.finished",
      run_id: "run-synth-001",
      payload: {},
    });
    expect(received).toEqual([jobHint, { invalid: true }, artifactHint]);
    expect(runSignals.map((signal) => signal.event)).toEqual(["run.finished"]);
  });

  it("never forwards decoded hints to the per-turn sendMessage stream callback", async () => {
    const adapter = new WsChatAdapter("ws://daemon");
    const streamed: Array<{ event?: string }> = [];
    const hints: unknown[] = [];
    adapter.onImageHint((hint) => hints.push(hint));
    wsHarness.harness.nextResponse = {
      ok: true,
      data: {
        status: "waiting_for_input",
        run_id: "run-1",
        question_id: "question-1",
        snapshot_ref: "user_question:question-1",
      },
    };
    // Waiting turns keep the stream handler registered, so it can observe later frames.
    await adapter.sendMessage("start", "session-1", (event) => streamed.push(event));
    const client = wsHarness.harness.client;
    client?.emit(jobHint);
    client?.emit({
      type: "event",
      version: "v1",
      event: "run.delta",
      payload: { delta: "x" },
    });
    client?.emit(artifactHint);

    expect(streamed.map((event) => event.event)).toEqual(["run.delta"]);
    expect(hints).toEqual([jobHint, artifactHint]);
    wsHarness.harness.reset();
  });

  it("sends canonical inference_target alongside execution_target in sessions.create", async () => {
    const adapter = new WsChatAdapter("ws://daemon");
    wsHarness.harness.nextResponse = {
      ok: true,
      data: {
        id: "sess-created-1",
        channel: "ws",
        status: "active",
        started_at: 1000,
        updated_at: 1000,
        inference_target: { kind: "server", provider_id: "default" },
        execution_target: { kind: "server", provider_id: "default" },
      },
    };

    const target = { kind: "server" as const, provider_id: "default" };
    const res = await adapter.createSession(target);

    expect(res.id).toBe("sess-created-1");
    expect(wsHarness.harness.sent).toHaveLength(1);
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "sessions.create",
      params: {
        inference_target: target,
        execution_target: target,
      },
      options: { fence: undefined },
    });
    wsHarness.harness.reset();
  });
});

describe("WsChatAdapter reconnect gap reconciliation", () => {
  it("UI-08: on reconnect triggers authoritative gap reconciliation across hosts, pools, recoveries, installation, mutations, and active operations", async () => {
    const originalState = useInferenceStore.getState();
    const fetchHostsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchPoolsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchCredentialRecoveriesSpy = vi.fn().mockResolvedValue(undefined);
    const fetchInstallationSpy = vi.fn().mockResolvedValue(null);
    const reconcileMutationsSpy = vi.fn().mockResolvedValue(undefined);
    const pollActiveOpSpy = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      fetchHosts: fetchHostsSpy,
      fetchPools: fetchPoolsSpy,
      fetchCredentialRecoveries: fetchCredentialRecoveriesSpy,
      fetchInstallation: fetchInstallationSpy,
      reconcilePersistedMutations: reconcileMutationsSpy,
      pollActiveOperation: pollActiveOpSpy,
      activeInstallationId: "inst-recon-1",
      operations: {
        "op-running-1": {
          operation_id: "op-running-1",
          host_id: "host-1",
          artifact_id: "gemma-4",
          execution_target_kind: "pool",
          kind: "load",
          state: "running",
          stage: "load_context",
          status: "active",
          revision: 1,
          started_at_ms: 1000,
          updated_at_ms: 1000,
          counters: {},
        },
        "op-completed-1": {
          operation_id: "op-completed-1",
          host_id: "host-1",
          artifact_id: "gemma-4",
          execution_target_kind: "pool",
          kind: "load",
          state: "completed",
          stage: "load_context",
          status: "completed",
          revision: 2,
          started_at_ms: 1000,
          updated_at_ms: 2000,
          counters: {},
        },
      },
    });

    try {
      const adapter = new WsChatAdapter("ws://daemon");
      useConnectionStore.getState().setSessionId("sess-recon");
      wsHarness.harness.responses = [
        {
          ok: true,
          data: {
            version: "1.0",
            session: { id: "sess-recon" },
          },
        },
        {
          ok: true,
          data: {
            session: {
              id: "sess-recon",
              channel: "ws",
              status: "active",
              started_at: 1000,
              updated_at: 1000,
            },
          },
        },
      ];
      expect(wsHarness.harness.reconnectHandler).toBeDefined();
      await wsHarness.harness.reconnectHandler!();

      expect(fetchHostsSpy).toHaveBeenCalled();
      expect(fetchPoolsSpy).toHaveBeenCalled();
      expect(fetchCredentialRecoveriesSpy).toHaveBeenCalled();
      expect(fetchInstallationSpy).toHaveBeenCalledWith("inst-recon-1");
      expect(reconcileMutationsSpy).toHaveBeenCalled();
      expect(pollActiveOpSpy).toHaveBeenCalledWith("op-running-1");
      expect(pollActiveOpSpy).not.toHaveBeenCalledWith("op-completed-1");
    } finally {
      useInferenceStore.setState(originalState);
      wsHarness.harness.reset();
    }
  });
});

describe("WsChatAdapter typed error mapping and RPC options (Phase 03)", () => {
  it("throws WsRequestError with server code and method on ok:false response", async () => {
    wsHarness.harness.reset();
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");
    wsHarness.harness.nextResponse = {
      ok: false,
      error: { code: "unauthorized", message: "Bearer token invalid" },
    };

    await expect(adapter.connect("bad-token")).rejects.toSatisfy((err: unknown) => {
      return (
        isWsRequestError(err, "unauthorized") &&
        err.message === "Bearer token invalid" &&
        err.method === "connect"
      );
    });
  });

  it("sends chat.send with timeoutMs: null so it carries no deadline", async () => {
    wsHarness.harness.reset();
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");
    wsHarness.harness.nextResponse = {
      ok: true,
      data: {
        content: "done",
        tool_calls_made: 0,
      },
    };

    await adapter.sendMessage("hello", "sess-1", () => {});
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "chat.send",
      params: { message: "hello", session_id: "sess-1", stream: true },
      options: { timeoutMs: null },
    });
  });

  it("routes abort through call helper and throws WsRequestError on failure", async () => {
    wsHarness.harness.reset();
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");
    wsHarness.harness.nextResponse = {
      ok: false,
      error: { code: "run_not_found", message: "No active run" },
    };

    await expect(adapter.abort()).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "run_not_found") && err.method === "chat.abort";
    });
  });
});

describe("WsChatAdapter sessions.get and paged sessions.list (Phase 04)", () => {
  it("resolves stored session via getSession and does not call sessions.create or sessions.list", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("existing-session");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      { ok: true, data: { session_id: "existing-session", version: "v1" } },
      { ok: true, data: { session: { id: "existing-session", status: "active" } } },
    ];

    const result = await adapter.connect();
    expect(result.session_id).toBe("existing-session");
    expect(wsHarness.harness.sent.length).toBe(2);
    expect(wsHarness.harness.sent[0].method).toBe("connect");
    expect(wsHarness.harness.sent[1]).toEqual({
      method: "sessions.get",
      params: { id: "existing-session" },
      options: { fence: undefined },
    });
  });

  it("creates a new session when stored id is absent", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId(undefined);
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      { ok: true, data: { session_id: "old-id", version: "v1" } },
      { ok: true, data: { id: "new-session", status: "active", started_at: 1, updated_at: 1 } },
    ];

    const result = await adapter.connect();
    expect(result.session_id).toBe("new-session");
    expect(useConnectionStore.getState().sessionId).toBe("new-session");
    expect(wsHarness.harness.sent.length).toBe(2);
    expect(wsHarness.harness.sent[0].method).toBe("connect");
    expect(wsHarness.harness.sent[1].method).toBe("sessions.create");
  });

  it("creates a new session when stored id returns not_found", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("missing-session");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      { ok: true, data: { session_id: "missing-session", version: "v1" } },
      { ok: false, error: { code: "not_found", message: "Session not found" } },
      { ok: true, data: { id: "created-after-404", status: "active", started_at: 1, updated_at: 1 } },
    ];

    const result = await adapter.connect();
    expect(result.session_id).toBe("created-after-404");
    expect(useConnectionStore.getState().sessionId).toBe("created-after-404");
    expect(wsHarness.harness.sent.length).toBe(3);
    expect(wsHarness.harness.sent[0].method).toBe("connect");
    expect(wsHarness.harness.sent[1]).toEqual({
      method: "sessions.get",
      params: { id: "missing-session" },
      options: { fence: undefined },
    });
    expect(wsHarness.harness.sent[2].method).toBe("sessions.create");
  });

  it("propagates transport error on sessions.get and never creates a session", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("some-session");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      { ok: true, data: { session_id: "some-session", version: "v1" } },
      { ok: false, error: { code: "timeout", message: "RPC timed out" } },
    ];

    await expect(adapter.connect()).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "timeout");
    });
    // sessions.create must NOT have been called
    expect(wsHarness.harness.sent.length).toBe(2);
    expect(wsHarness.harness.sent.some((s) => s.method === "sessions.create")).toBe(false);
  });

  it("maps method_not_found on sessions.get to unsupported_daemon error and never lists sessions", async () => {
    wsHarness.harness.reset();
    useConnectionStore.getState().setSessionId("sess-old-daemon");
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");

    wsHarness.harness.responses = [
      { ok: true, data: { session_id: "sess-old-daemon", version: "v1" } },
      { ok: false, error: { code: "method_not_found", message: "Unknown method sessions.get" } },
    ];

    await expect(adapter.connect()).rejects.toSatisfy((err: unknown) => {
      return (
        isWsRequestError(err, "unsupported_daemon") &&
        err.message.includes("upgrade the daemon")
      );
    });
    expect(wsHarness.harness.sent.some((s) => s.method === "sessions.list")).toBe(false);
    expect(wsHarness.harness.sent.some((s) => s.method === "sessions.create")).toBe(false);
  });

  it("calls listSessions with query parameters and passes fence", async () => {
    wsHarness.harness.reset();
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");
    const mockResponse = {
      sessions: [{ id: "s-1", channel: "ws", status: "active", started_at: 1, updated_at: 2 }],
      next_cursor: "cur-123",
    };
    wsHarness.harness.nextResponse = { ok: true, data: mockResponse };

    const fence = { signal: new AbortController().signal, epoch: 1 };
    const result = await adapter.listSessions({ limit: 25, cursor: "cur-000" }, fence);

    expect(result).toEqual(mockResponse);
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "sessions.list",
      params: { limit: 25, cursor: "cur-000" },
      options: { fence },
    });
  });

  it("calls getSession directly with id and fence", async () => {
    wsHarness.harness.reset();
    const adapter = new WsChatAdapter("ws://localhost:18790/ws");
    const mockSession = { id: "target-1", channel: "web", status: "active", started_at: 1, updated_at: 1 };
    wsHarness.harness.nextResponse = { ok: true, data: { session: mockSession } };

    const fence = { signal: new AbortController().signal, epoch: 1 };
    const result = await adapter.getSession("target-1", fence);

    expect(result).toEqual(mockSession);
    expect(wsHarness.harness.sent[0]).toEqual({
      method: "sessions.get",
      params: { id: "target-1" },
      options: { fence },
    });
  });
});
