import {
  decodeTaskProgressWsEvent,
  decodeUserQuestionEvent,
  decodeWsFrameJson,
  type WsReq,
  type WsRes,
  type WsEvent,
} from "@nonclaw-ui/shared/types";
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS } from "@nonclaw-ui/shared/constants";

type PendingRequest = {
  resolve: (res: WsRes) => void;
  reject: (err: Error) => void;
};

export interface WsReconnectFence {
  epoch: number;
  signal: AbortSignal;
}

type WsConnectionStatus = "reconnecting" | "offline" | "connected";

/** Preserve legacy events while rejecting malformed additive G6 events. */
export function decodeInboundWsEvent(frame: WsEvent): WsEvent | undefined {
  if (frame.event === "user_question.updated") {
    try {
      return decodeUserQuestionEvent(frame);
    } catch {
      return undefined;
    }
  }
  if (frame.event !== "task_progress.updated") return frame;
  try {
    return decodeTaskProgressWsEvent(frame);
  } catch {
    return undefined;
  }
}

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers: Array<(event: WsEvent) => void> = [];
  private reconnectAttempts = 0;
  private onReconnectCallback: ((fence: WsReconnectFence) => Promise<void>) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInFlight = false;
  private stopped = false;
  private lifecycleEpoch = 0;
  private reconnectAbort?: AbortController;
  private statusHandlers: Array<(status: WsConnectionStatus) => void> = [];
  private protocolErrorHandlers: Array<() => void> = [];

  constructor(private readonly url: string) {}

  connect(timeoutMs = 10_000): Promise<void> {
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.lifecycleEpoch += 1;
    this.reconnectInFlight = false;
    this.reconnectAbort?.abort();
    this.reconnectAbort = undefined;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    return this.open(timeoutMs);
  }

  private open(timeoutMs = 10_000): Promise<void> {
    // Tear down any existing socket without triggering the reconnect loop.
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState !== WebSocket.CLOSED) {
        this.ws.close();
      }
      this.ws = null;
    }
    return new Promise((resolve, reject) => {
      let opened = false;
      let closeHandled = false;
      const timer = setTimeout(() => {
        // Detach so onclose doesn't cascade into the reconnect loop.
        if (this.ws === ws) this.ws = null;
        ws.close();
        reject(new Error(`WS connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const ws = new WebSocket(this.url);
      this.ws = ws;
      const handleClosed = () => {
        if (closeHandled) return;
        closeHandled = true;
        if (this.ws !== ws) return;
        this.ws = null;
        this.handleClose();
      };
      ws.onopen = () => {
        clearTimeout(timer);
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        if (!opened) {
          // Detach from this.ws so the subsequent onclose doesn't trigger the
          // auto-reconnect loop for an explicit connect() failure.
          if (this.ws === ws) this.ws = null;
          reject(new Error("WS connection failed"));
          return;
        }
        // Established sockets must enter the same recovery path as close. Some
        // runtimes deliver error and close separately; closeHandled fences the
        // duplicate notification and preserves the reconnect loop.
        handleClosed();
        if (ws.readyState !== WebSocket.CLOSED) ws.close();
      };
      ws.onmessage = (e) => this.handleMessage(e.data);
      ws.onclose = handleClosed;
    });
  }

  /** Register a callback invoked after reconnect completes (e.g. for re-auth). */
  onReconnect(cb: (fence: WsReconnectFence) => Promise<void>) {
    this.onReconnectCallback = cb;
  }

  onConnectionStatus(cb: (status: WsConnectionStatus) => void) {
    this.statusHandlers.push(cb);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((handler) => handler !== cb);
    };
  }

  onProtocolError(cb: () => void) {
    this.protocolErrorHandlers.push(cb);
    return () => {
      this.protocolErrorHandlers = this.protocolErrorHandlers.filter((handler) => handler !== cb);
    };
  }

  private notifyStatus(status: WsConnectionStatus) {
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private handleMessage(raw: string) {
    const frame = decodeWsFrameJson(raw);
    if (!frame) {
      this.protocolErrorHandlers.forEach((handler) => handler());
      return;
    }
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        pending.resolve(frame);
      }
    } else if (frame.type === "event") {
      const event = decodeInboundWsEvent(frame);
      if (event) {
        this.eventHandlers.forEach((h) => h(event));
      } else {
        this.protocolErrorHandlers.forEach((handler) => handler());
      }
    }
  }

  private handleClose() {
    this.reconnectAbort?.abort();
    this.reconnectAbort = undefined;
    this.reconnectInFlight = false;
    // Reject all in-flight requests so callers don't hang.
    for (const [, pending] of this.pending) {
      pending.reject(new Error("WS connection closed"));
    }
    this.pending.clear();

    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (
      this.stopped ||
      this.reconnectTimer !== null ||
      this.reconnectInFlight ||
      this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS
    ) {
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) this.notifyStatus("offline");
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    const lifecycleEpoch = this.lifecycleEpoch;
    const reconnectAbort = new AbortController();
    this.reconnectAbort = reconnectAbort;
    this.notifyStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || lifecycleEpoch !== this.lifecycleEpoch) return;
      this.reconnectInFlight = true;
      this.open()
        .then(() => {
          if (
            this.stopped ||
            lifecycleEpoch !== this.lifecycleEpoch ||
            reconnectAbort.signal.aborted
          ) {
            return;
          }
          return this.onReconnectCallback?.({ epoch: lifecycleEpoch, signal: reconnectAbort.signal });
        })
        .then(() => {
          if (
            this.stopped ||
            lifecycleEpoch !== this.lifecycleEpoch ||
            reconnectAbort.signal.aborted
          ) {
            return;
          }
          this.reconnectAttempts = 0;
          this.reconnectInFlight = false;
          this.notifyStatus("connected");
        })
        .catch(() => {
          if (
            this.stopped ||
            lifecycleEpoch !== this.lifecycleEpoch ||
            reconnectAbort.signal.aborted
          ) {
            return;
          }
          this.reconnectInFlight = false;
          this.scheduleReconnect();
        })
        .finally(() => {
          if (this.reconnectAbort === reconnectAbort) {
            this.reconnectAbort = undefined;
          }
        });
    }, delay);
  }

  send<P, D = unknown>(
    method: string,
    params: P,
    fence?: WsReconnectFence
  ): Promise<WsRes<D>> {
    return new Promise((resolve, reject) => {
      if (fence && (fence.signal.aborted || fence.epoch !== this.lifecycleEpoch)) {
        reject(new Error("WS request superseded"));
        return;
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WS not connected"));
        return;
      }
      const id = crypto.randomUUID();
      const req: WsReq<P> = { type: "req", version: "v1", id, method, params };
      let cleanup = () => {};
      const pending: PendingRequest = {
        resolve: (response) => {
          cleanup();
          resolve(response as WsRes<D>);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      this.pending.set(id, pending);
      if (fence) {
        const onAbort = () => {
          if (this.pending.get(id) !== pending) return;
          this.pending.delete(id);
          pending.reject(new Error("WS request aborted"));
        };
        cleanup = () => fence.signal.removeEventListener("abort", onAbort);
        fence.signal.addEventListener("abort", onAbort, { once: true });
        if (fence.signal.aborted) {
          onAbort();
          return;
        }
      }
      this.ws.send(JSON.stringify(req));
    });
  }

  onEvent(handler: (event: WsEvent) => void) {
    this.eventHandlers.push(handler);
  }

  removeEventHandler(handler: (event: WsEvent) => void) {
    this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
  }

  disconnect() {
    this.stopped = true;
    this.lifecycleEpoch += 1;
    this.reconnectInFlight = false;
    this.reconnectAbort?.abort();
    this.reconnectAbort = undefined;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error("WS disconnected"));
    }
    this.pending.clear();
    this.notifyStatus("offline");
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
