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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws?.close();
        reject(new Error(`WS connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        clearTimeout(timer);
        this.reconnectAttempts = 0;
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("WS connection failed"));
      };
      this.ws.onmessage = (e) => this.handleMessage(e.data as string);
      this.ws.onclose = () => this.handleClose();
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
      const req: WsReq<P> = { type: "req", id, method, params };
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
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
