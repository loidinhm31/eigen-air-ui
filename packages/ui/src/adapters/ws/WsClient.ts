import type { WsReq, WsRes, WsEvent, WsFrame } from "@nonclaw-ui/shared/types";
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS } from "@nonclaw-ui/shared/constants";

type PendingRequest = {
  resolve: (res: WsRes) => void;
  reject: (err: Error) => void;
};

export class WsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers: Array<(event: WsEvent) => void> = [];
  private reconnectAttempts = 0;
  private onReconnectCallback: (() => Promise<void>) | null = null;

  constructor(private readonly url: string) {}

  connect(timeoutMs = 10_000): Promise<void> {
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
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Detach so onclose doesn't cascade into the reconnect loop.
        if (this.ws === ws) this.ws = null;
        ws.close();
        reject(new Error(`WS connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        // Detach from this.ws so the subsequent onclose doesn't trigger the
        // auto-reconnect loop for an explicit connect() failure.
        if (this.ws === ws) this.ws = null;
        reject(new Error("WS connection failed"));
      };
      ws.onmessage = (e) => this.handleMessage(e.data as string);
      ws.onclose = () => {
        // Only start the reconnect loop for sockets that were fully established,
        // not ones that failed during the initial connect() call.
        if (this.ws === ws) this.handleClose();
      };
    });
  }

  /** Register a callback invoked after reconnect completes (e.g. for re-auth). */
  onReconnect(cb: () => Promise<void>) {
    this.onReconnectCallback = cb;
  }

  private handleMessage(raw: string) {
    const frame = JSON.parse(raw) as WsFrame;
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        pending.resolve(frame);
      }
    } else if (frame.type === "event") {
      this.eventHandlers.forEach((h) => h(frame));
    }
  }

  private handleClose() {
    // Reject all in-flight requests so callers don't hang.
    for (const [, pending] of this.pending) {
      pending.reject(new Error("WS connection closed"));
    }
    this.pending.clear();

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect()
          .then(() => this.onReconnectCallback?.())
          .catch(() => {});
      }, delay);
    }
  }

  send<P, D = unknown>(method: string, params: P): Promise<WsRes<D>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WS not connected"));
        return;
      }
      const id = crypto.randomUUID();
      const req: WsReq<P> = { type: "req", version: "v1", id, method, params };
      this.pending.set(id, {
        resolve: resolve as (r: WsRes) => void,
        reject,
      });
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
    this.onReconnectCallback = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error("WS disconnected"));
    }
    this.pending.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
