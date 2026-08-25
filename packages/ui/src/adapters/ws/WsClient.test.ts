import { afterEach, describe, expect, it, vi } from "vitest";
import type { WsEvent } from "@nonclaw-ui/shared/types";
import { RECONNECT_DELAY_MS } from "@nonclaw-ui/shared/constants";
import { decodeInboundWsEvent, WsClient } from "./WsClient.js";

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
      await client.send("connect", {}, fence);
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
