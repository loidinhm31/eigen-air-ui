import { afterEach, describe, expect, it, vi } from "vitest";
import type { WsEvent } from "@eigen-air-ui/shared/types";
import { RECONNECT_DELAY_MS } from "@eigen-air-ui/shared/constants";
import { decodeInboundWsEvent, WsClient } from "./WsClient.js";
import { isWsRequestError } from "./ws-request-error.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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
describe("WsClient requests", () => {
  it("falls back to getRandomValues when randomUUID is unavailable", async () => {
    const sockets: FakeWebSocket[] = [];
    const sent: string[] = [];
    class FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }

      send(value: string) {
        sent.push(value);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("crypto", {
      getRandomValues: (values: Uint8Array) => values.fill(0x11),
    });

    const client = new WsClient("ws://daemon");
    const connected = client.connect();
    sockets[0]?.open();
    await connected;

    const pending = client.send("ping", {});
    const request = JSON.parse(sent[0] ?? "") as { id: string };
    sockets[0]?.onmessage?.({
      data: JSON.stringify({ type: "res", version: "v1", id: request.id, ok: true }),
    });

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(request.id).toBe("11111111-1111-4111-9111-111111111111");
    client.disconnect();
  });
  it("prefers native randomUUID when available", async () => {
    const sockets: FakeWebSocket[] = [];
    const sent: string[] = [];
    const randomUUID = vi.fn().mockReturnValue("native-id");
    const getRandomValues = vi.fn();
    class FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }

      send(value: string) {
        sent.push(value);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });

    const client = new WsClient("ws://daemon");
    const connected = client.connect();
    sockets[0]?.open();
    await connected;

    const pending = client.send("ping", {});
    const request = JSON.parse(sent[0] ?? "") as { id: string };
    sockets[0]?.onmessage?.({
      data: JSON.stringify({ type: "res", version: "v1", id: request.id, ok: true }),
    });

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(request.id).toBe("native-id");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("rejects when Web Crypto cannot generate request IDs", async () => {
    const sockets: FakeWebSocket[] = [];
    const sent: string[] = [];
    class FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }

      send(value: string) {
        sent.push(value);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("crypto", undefined);

    const client = new WsClient("ws://daemon");
    const connected = client.connect();
    sockets[0]?.open();
    await connected;

    await expect(client.send("ping", {})).rejects.toThrow("Web Crypto API unavailable");
    expect(sent).toHaveLength(0);
    client.disconnect();
  });
});



describe("WsClient lifecycle", () => {
  it("recovers established socket errors and preserves re-auth after explicit disconnect", async () => {
    vi.useFakeTimers();
    const sockets: Array<{
      readyState: number;
      onopen: (() => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      open: () => void;
      fail: () => void;
      close: () => void;
      send: (value: string) => void;
    }> = [];
    class FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      fail() {
        this.onerror?.();
        this.onclose?.();
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
      }

      send(value: string) {
        void value;
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const client = new WsClient("ws://daemon");
    const reauthenticate = vi.fn().mockResolvedValue(undefined);
    const statuses: string[] = [];
    client.onReconnect(reauthenticate);
    client.onConnectionStatus((status) => statuses.push(status));

    const initialConnect = client.connect();
    sockets[0]?.open();
    await initialConnect;
    sockets[0]?.fail();
    expect(statuses).toContain("reconnecting");

    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(reauthenticate).toHaveBeenCalledOnce();

    client.disconnect();
    const secondConnect = client.connect();
    sockets[2]?.open();
    await secondConnect;
    sockets[2]?.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    expect(sockets).toHaveLength(4);
    sockets[3]?.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(reauthenticate).toHaveBeenCalledTimes(2);
    client.disconnect();
  });

  it("aborts an in-flight reconnect request when the socket lifecycle is replaced", async () => {
    vi.useFakeTimers();
    interface TestSocket {
      readyState: number;
      onopen: (() => void) | null;
      onerror: (() => void) | null;
      onclose: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      open: () => void;
      close: () => void;
      send: (value: string) => void;
    }
    const sockets: TestSocket[] = [];
    class FakeWebSocket implements TestSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
      }

      send(value: string) {
        void value;
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const client = new WsClient("ws://daemon");
    let reconnectFence: { epoch: number; signal: AbortSignal } | undefined;
    let authRequestResolved = false;
    client.onReconnect(async (fence) => {
      reconnectFence = fence;
      await client.send("connect", {}, { fence });
      authRequestResolved = true;
    });

    const initialConnect = client.connect();
    sockets[0]?.open();
    await initialConnect;
    sockets[0]?.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAY_MS);
    sockets[1]?.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(reconnectFence).toBeDefined();
    expect(authRequestResolved).toBe(false);

    client.disconnect();
    await Promise.resolve();
    await Promise.resolve();
    expect(reconnectFence?.signal.aborted).toBe(true);
    expect(authRequestResolved).toBe(false);
  });
});

describe("WsClient image hints", () => {
  const hint = {
    type: "event",
    version: "v1",
    event: "image_job.updated",
    session_id: "session-1",
    run_id: "run-1",
    payload: {
      job_id: "job-1",
      session_id: "session-1",
      run_id: "run-1",
      state: "running",
      revision: 2,
      requested_count: 1,
      completed_count: 0,
    },
  };

  it("decodes valid hints and drops malformed ones in decodeInboundWsEvent", () => {
    expect(decodeInboundWsEvent(hint as unknown as WsEvent)).toMatchObject({
      event: "image_job.updated",
      payload: { job_id: "job-1" },
    });
    const withPrompt = { ...hint, payload: { ...hint.payload, prompt: "secret" } };
    expect(decodeInboundWsEvent(withPrompt as unknown as WsEvent)).toBeUndefined();
    const scopeMismatch = { ...hint, payload: { ...hint.payload, run_id: "run-2" } };
    expect(decodeInboundWsEvent(scopeMismatch as unknown as WsEvent)).toBeUndefined();
    const unknownVersion = { ...hint, version: "v2" };
    expect(decodeInboundWsEvent(unknownVersion as unknown as WsEvent)).toBeUndefined();
  });

  it("signals malformed hints separately from protocol errors and keeps the stream alive", async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        sockets.push(this);
      }
      close() {
        this.readyState = FakeSocket.CLOSED;
      }
      send() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);

    const client = new WsClient("ws://daemon");
    const events: string[] = [];
    const invalid = vi.fn();
    const protocolError = vi.fn();
    client.onEvent((event) => events.push(event.event));
    client.onInvalidImageHint(invalid);
    client.onProtocolError(protocolError);
    const connected = client.connect();
    const socket = sockets[0];
    if (!socket) throw new Error("socket not created");
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    await connected;

    const deliver = (frame: unknown) => socket.onmessage?.({ data: JSON.stringify(frame) });
    deliver(hint);
    deliver({ ...hint, payload: { ...hint.payload, state: "exploded" } });
    deliver({ ...hint, event: "image_artifact.committed", payload: { artifact_id: "a" } });
    deliver({ type: "event", version: "v1", event: "run.delta", payload: { delta: "x" } });

    expect(events).toEqual(["image_job.updated", "run.delta"]);
    expect(invalid).toHaveBeenCalledTimes(2);
    expect(protocolError).not.toHaveBeenCalled();

    // An undecodable frame may have been a hint: both signals fire.
    socket.onmessage?.({ data: "{not json" });
    expect(protocolError).toHaveBeenCalledOnce();
    expect(invalid).toHaveBeenCalledTimes(3);
    client.disconnect();
  });

  it("isolates a throwing invalid-hint handler: later handlers, protocol errors and frames still run", async () => {
    class FakeSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      static last: FakeSocket | undefined;
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        FakeSocket.last = this;
      }
      close() {
        this.readyState = FakeSocket.CLOSED;
      }
      send() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);

    const client = new WsClient("ws://daemon");
    const events: string[] = [];
    const healthy = vi.fn();
    const protocolError = vi.fn();
    client.onEvent((event) => events.push(event.event));
    client.onInvalidImageHint(() => {
      throw new Error("handler boom");
    });
    client.onInvalidImageHint(healthy);
    client.onProtocolError(protocolError);
    const connected = client.connect();
    const socket = FakeSocket.last;
    if (!socket) throw new Error("socket not created");
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    await connected;

    const malformedHint = { ...hint, payload: { ...hint.payload, state: "exploded" } };
    expect(() => socket.onmessage?.({ data: JSON.stringify(malformedHint) })).not.toThrow();
    expect(() => socket.onmessage?.({ data: "{not json" })).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(protocolError).toHaveBeenCalledOnce();

    socket.onmessage?.({ data: JSON.stringify(hint) });
    socket.onmessage?.({
      data: JSON.stringify({
        type: "event",
        version: "v1",
        event: "run.delta",
        payload: { delta: "x" },
      }),
    });
    expect(events).toEqual(["image_job.updated", "run.delta"]);
    client.disconnect();
  });
});

describe("WsClient request deadlines and settlement (Phase 03)", () => {
  class TestSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    readyState = 0;
    sent: string[] = [];
    closedWithCode?: number;
    closedWithReason?: string;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    open() {
      this.readyState = TestSocket.OPEN;
      this.onopen?.();
    }
    close(code?: number, reason?: string) {
      this.readyState = TestSocket.CLOSED;
      this.closedWithCode = code;
      this.closedWithReason = reason;
      this.onclose?.();
    }
    send(data: string) {
      this.sent.push(data);
    }
  }

  it("times out pending request and ignores late response", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const requestPromise = client.send("test.method", { foo: "bar" }, { timeoutMs: 1000 });
    const timerBaseline = vi.getTimerCount();
    expect(timerBaseline).toBeGreaterThan(0);

    const req = JSON.parse(socket!.sent[0] ?? "{}") as { id: string };
    expect(req.id).toBeDefined();

    vi.advanceTimersByTime(1000);
    await expect(requestPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isWsRequestError(err, "timeout") &&
        err.message === "test.method timed out after 1000ms; outcome unknown" &&
        err.method === "test.method"
      );
    });

    // Late response arriving after timeout should be ignored cleanly
    expect(() => {
      socket?.onmessage?.({
        data: JSON.stringify({ type: "res", version: "v1", id: req.id, ok: true, data: "late" }),
      });
    }).not.toThrow();

    client.disconnect();
  });

  it("survives 10 minutes when timeoutMs is null and then resolves", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const requestPromise = client.send("chat.send", { text: "hello" }, { timeoutMs: null });
    const req = JSON.parse(socket!.sent[0] ?? "{}") as { id: string };

    // Advance 10 minutes (600,000 ms)
    vi.advanceTimersByTime(10 * 60 * 1000);

    // Still pending, now deliver response
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "res",
        version: "v1",
        id: req.id,
        ok: true,
        data: { status: "completed", content: "done" },
      }),
    });

    await expect(requestPromise).resolves.toMatchObject({
      ok: true,
      data: { status: "completed", content: "done" },
    });

    client.disconnect();
  });

  it("rejects only matching request on invalid_response without affecting peers", async () => {
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const req1Promise = client.send("rpc.one", {});
    const req2Promise = client.send("rpc.two", {});

    const req1 = JSON.parse(socket!.sent[0] ?? "{}") as { id: string };
    const req2 = JSON.parse(socket!.sent[1] ?? "{}") as { id: string };

    // Deliver invalid response envelope for req1 (extra key in error)
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "res",
        version: "v1",
        id: req1.id,
        ok: false,
        error: { code: "err", message: "fail", forbidden_extra: true },
      }),
    });

    await expect(req1Promise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "invalid_response");
    });

    // req2 is still alive and resolves normally
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "res",
        version: "v1",
        id: req2.id,
        ok: true,
        data: "success",
      }),
    });

    await expect(req2Promise).resolves.toMatchObject({ ok: true, data: "success" });
    client.disconnect();
  });

  it("rejects all pending on undecodable frame, closes socket with 4002, and schedules reconnect", async () => {
    vi.useFakeTimers();
    const sockets: TestSocket[] = [];
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        sockets.push(this);
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    sockets[0]?.open();
    await connectPromise;

    const req1Promise = client.send("rpc.one", {});
    const req2Promise = client.send("rpc.two", {});

    // Deliver undecodable frame
    sockets[0]?.onmessage?.({ data: "not a valid json frame at all" });

    await expect(req1Promise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "protocol_desync");
    });
    await expect(req2Promise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "protocol_desync");
    });

    expect(sockets[0]?.closedWithCode).toBe(4002);
    expect(sockets[0]?.closedWithReason).toBe("protocol_desync");

    // Advance by reconnect delay -> second socket created
    vi.advanceTimersByTime(RECONNECT_DELAY_MS);
    expect(sockets.length).toBe(2);

    client.disconnect();
  });

  it("does not reject pending requests on invalid_event or unsupported frames", async () => {
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const reqPromise = client.send("rpc.query", {});
    const req = JSON.parse(socket!.sent[0] ?? "{}") as { id: string };

    // Deliver unsupported frame
    socket?.onmessage?.({
      data: JSON.stringify({ type: "unknown_custom_type", version: "v9" }),
    });

    // Deliver invalid event (oversized or malformed)
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "event",
        event: "user_question.updated",
        payload: { invalid_key_structure: true },
      }),
    });

    // reqPromise should still be pending and resolve
    socket?.onmessage?.({
      data: JSON.stringify({
        type: "res",
        version: "v1",
        id: req.id,
        ok: true,
        data: "all good",
      }),
    });

    await expect(reqPromise).resolves.toMatchObject({ ok: true, data: "all good" });
    client.disconnect();
  });

  it("rejects pending requests with connection_replaced when socket is replaced in open()", async () => {
    const sockets: TestSocket[] = [];
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        sockets.push(this);
      }
    });

    const client = new WsClient("ws://daemon");
    const connect1 = client.connect();
    sockets[0]?.open();
    await connect1;

    const reqPromise = client.send("rpc.first", {});

    // Reconnecting before response arrives
    const connect2 = client.connect();
    sockets[1]?.open();
    await connect2;

    await expect(reqPromise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "connection_replaced");
    });

    client.disconnect();
  });

  it("cleans up timer count when fence aborts", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const initialTimers = vi.getTimerCount();
    const abortController = new AbortController();
    const reqPromise = client.send("rpc.fenced", {}, {
      fence: { signal: abortController.signal, epoch: 1 },
      timeoutMs: 10_000,
    });

    expect(vi.getTimerCount()).toBe(initialTimers + 1);

    abortController.abort();
    await expect(reqPromise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "aborted");
    });

    expect(vi.getTimerCount()).toBe(initialTimers);
    client.disconnect();
  });

  it("cleans up timer count and rejects if ws.send throws synchronously", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
      override send() {
        throw new Error("Network write failure");
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const initialTimers = vi.getTimerCount();
    await expect(
      client.send("rpc.fail", {}, { timeoutMs: 5000 })
    ).rejects.toThrow("Network write failure");

    expect(vi.getTimerCount()).toBe(initialTimers);
    client.disconnect();
  });

  it("settles protocol_desync even if a protocol error handler throws", async () => {
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    client.onProtocolError(() => {
      throw new Error("subscriber exploded");
    });

    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const reqPromise = client.send("rpc.resilient", {});
    expect(() => {
      socket?.onmessage?.({ data: "not-json" });
    }).not.toThrow();

    await expect(reqPromise).rejects.toSatisfy((err: unknown) => {
      return isWsRequestError(err, "protocol_desync");
    });
    client.disconnect();
  });

  it("enforces default 30-second deadline when options are omitted", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const reqPromise = client.send("rpc.default_timeout", {});
    // Advance 29.9s -> still pending
    vi.advanceTimersByTime(29_900);
    let settled = false;
    reqPromise.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Advance remaining 100ms -> times out at 30,000ms
    vi.advanceTimersByTime(100);
    await expect(reqPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isWsRequestError(err, "timeout") &&
        err.message === "rpc.default_timeout timed out after 30000ms; outcome unknown"
      );
    });
    client.disconnect();
  });

  it("rejects non-positive or non-finite timeoutMs immediately with WsRequestError", async () => {
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    await expect(
      client.send("rpc.zero", {}, { timeoutMs: 0 })
    ).rejects.toSatisfy((err: unknown) => isWsRequestError(err, "timeout"));

    await expect(
      client.send("rpc.negative", {}, { timeoutMs: -100 })
    ).rejects.toSatisfy((err: unknown) => isWsRequestError(err, "timeout"));

    await expect(
      client.send("rpc.nan", {}, { timeoutMs: Number.NaN })
    ).rejects.toSatisfy((err: unknown) => isWsRequestError(err, "timeout"));

    client.disconnect();
  });

  it("cleans up timers and abort listeners on successful settlement", async () => {
    vi.useFakeTimers();
    let socket: TestSocket | undefined;
    vi.stubGlobal("WebSocket", class extends TestSocket {
      constructor() {
        super();
        socket = this;
      }
    });

    const client = new WsClient("ws://daemon");
    const connectPromise = client.connect();
    socket?.open();
    await connectPromise;

    const baselineTimers = vi.getTimerCount();
    const abortController = new AbortController();
    const reqPromise = client.send("rpc.success", {}, {
      fence: { signal: abortController.signal, epoch: 1 },
      timeoutMs: 15_000,
    });

    expect(vi.getTimerCount()).toBe(baselineTimers + 1);

    const req = JSON.parse(socket!.sent[0] ?? "{}") as { id: string };
    socket?.onmessage?.({
      data: JSON.stringify({ type: "res", version: "v1", id: req.id, ok: true, data: "done" }),
    });

    await expect(reqPromise).resolves.toMatchObject({ ok: true, data: "done" });
    expect(vi.getTimerCount()).toBe(baselineTimers);

    client.disconnect();
  });
});
