import {
  decodeImageHintWsEvent,
  isImageHintEventName,
  decodeTaskProgressWsEvent,
  decodeUserQuestionEvent,
  decodeToolApprovalEvent,
  decodeInferenceOperationProgressEvent,
  decodeRunInferenceProgressEvent,
  decodeWsInbound,
  type WsReq,
  type WsRes,
  type WsEvent,
} from "@eigen-air-ui/shared/types";
import {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
  DEFAULT_WS_REQUEST_TIMEOUT_MS,
} from "@eigen-air-ui/shared/constants";
import { safeRandomUUID } from "@eigen-air-ui/shared/utils";
import { WsRequestError, type WsTransportErrorCode } from "./ws-request-error.js";

type PendingRequest = {
  resolve: (res: WsRes) => void;
  reject: (err: Error) => void;
};

export interface WsReconnectFence {
  epoch: number;
  signal: AbortSignal;
}
export interface WsSendOptions {
  fence?: WsReconnectFence;
  timeoutMs?: number | null;
}


type WsConnectionStatus = "reconnecting" | "offline" | "connected";


/**
 * Preserve legacy events while rejecting malformed additive events. A malformed image hint
 * yields `undefined` here; `WsClient` reports it via `onInvalidImageHint` (not a protocol error).
 */
export function decodeInboundWsEvent(frame: WsEvent): WsEvent | undefined {
  if (frame.event === "user_question.updated") {
    try {
      return decodeUserQuestionEvent(frame);
    } catch {
      return undefined;
    }
  }
  if (frame.event === "tool_approval.updated") {
    try {
      return decodeToolApprovalEvent(frame);
    } catch {
      return undefined;
    }
  }
  if (isImageHintEventName(frame.event)) {
    try {
      return decodeImageHintWsEvent(frame);
    } catch {
      return undefined;
    }
  }
  if (
    frame.event === "inference.host.updated" ||
    frame.event === "inference.binding.updated" ||
    frame.event === "inference.pool.updated" ||
    frame.event === "inference.recovery.updated"
  ) {
    return frame;
  }
  if (frame.event === "inference.operation.updated") {
    try {
      const decodedPayload = decodeInferenceOperationProgressEvent(frame.payload);
      return { ...frame, payload: decodedPayload };
    } catch {
      if (frame.payload && typeof frame.payload === "object" && "operation_id" in frame.payload) {
        return frame;
      }
      return undefined;
    }
  }
  if (frame.event === "run.inference.progress") {
    try {
      const decodedPayload = decodeRunInferenceProgressEvent(frame.payload);
      return { ...frame, payload: decodedPayload };
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
  private invalidImageHintHandlers: Array<() => void> = [];

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
      const oldPending = Array.from(this.pending.values());
      this.pending.clear();
      for (const pending of oldPending) {
        pending.reject(new WsRequestError("connection_replaced", "WS connection replaced"));
      }
    }
    return new Promise((resolve, reject) => {
      let opened = false;
      let closeHandled = false;
      const timer = setTimeout(() => {
        // Detach so onclose doesn't cascade into the reconnect loop.
        if (this.ws === ws) this.ws = null;
        ws.close();
        reject(new WsRequestError("timeout", `WS connect timed out after ${timeoutMs}ms`));
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
          reject(new WsRequestError("connection_closed", "WS connection failed"));
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

  private notifyProtocolError() {
    for (const handler of [...this.protocolErrorHandlers]) {
      try {
        handler();
      } catch {
        // Isolated by design.
      }
    }
  }

  private failConnection(code: WsTransportErrorCode) {
    const oldPending = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of oldPending) {
      pending.reject(new WsRequestError(code, `WS connection failed: ${code}`));
    }
    if (this.ws) {
      try {
        this.ws.close(4002, "protocol_desync");
      } catch {
        // ws might already be closed or closing
      }
    }
  }

  /**
   * Fired for a malformed image hint, and for any undecodable frame (which may have been a hint:
   * hints are refetch signals, so a lost one must trigger the same snapshot refetch).
   */
  onInvalidImageHint(cb: () => void) {
    this.invalidImageHintHandlers.push(cb);
    return () => {
      this.invalidImageHintHandlers = this.invalidImageHintHandlers.filter(
        (handler) => handler !== cb
      );
    };
  }

  /** Each handler is isolated: a throwing one never skips the rest or later frames. */
  private emitInvalidImageHint() {
    for (const handler of [...this.invalidImageHintHandlers]) {
      try {
        handler();
      } catch {
        // Isolated by design.
      }
    }
  }

  private notifyStatus(status: WsConnectionStatus) {
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private handleMessage(raw: string) {
    const inbound = decodeWsInbound(raw);
    switch (inbound.kind) {
      case "frame": {
        const frame = inbound.frame;
        if (frame.type === "res") {
          const pending = this.pending.get(frame.id);
          if (pending) {
            this.pending.delete(frame.id);
            pending.resolve(frame);
          }
        } else if (frame.type === "event") {
          const event = decodeInboundWsEvent(frame);
          if (event) {
            this.eventHandlers.forEach((h) => {
              try {
                h(event);
              } catch {
                // Isolated
              }
            });
          } else if (isImageHintEventName(frame.event)) {
            this.emitInvalidImageHint();
          } else {
            this.notifyProtocolError();
          }
        }
        break;
      }
      case "invalid_response": {
        const pending = this.pending.get(inbound.id);
        if (pending) {
          this.pending.delete(inbound.id);
          pending.reject(
            new WsRequestError("invalid_response", "WS invalid response envelope")
          );
        }
        this.notifyProtocolError();
        break;
      }
      case "invalid_event": {
        if (inbound.event && isImageHintEventName(inbound.event)) {
          this.emitInvalidImageHint();
        } else {
          this.notifyProtocolError();
        }
        break;
      }
      case "unsupported": {
        this.notifyProtocolError();
        break;
      }
      case "undecodable": {
        this.emitInvalidImageHint();
        this.notifyProtocolError();
        this.failConnection("protocol_desync");
        break;
      }
    }
  }

  private handleClose() {
    this.reconnectAbort?.abort();
    this.reconnectAbort = undefined;
    this.reconnectInFlight = false;
    // Reject all in-flight requests so callers don't hang.
    const oldPending = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of oldPending) {
      pending.reject(new WsRequestError("connection_closed", "WS connection closed"));
    }

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
    options?: WsSendOptions
  ): Promise<WsRes<D>> {
    return new Promise((resolve, reject) => {
      const fence = options?.fence;
      if (fence && (fence.signal.aborted || fence.epoch !== this.lifecycleEpoch)) {
        reject(new WsRequestError("superseded", "WS request superseded", method));
        return;
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new WsRequestError("not_connected", "WS not connected", method));
        return;
      }

      let id: string;
      try {
        id = safeRandomUUID();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abortListener: (() => void) | null = null;

      const settle = (cb: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (abortListener !== null && fence) {
          fence.signal.removeEventListener("abort", abortListener);
          abortListener = null;
        }
        this.pending.delete(id);
        cb();
      };

      const pending: PendingRequest = {
        resolve: (response) => settle(() => resolve(response as WsRes<D>)),
        reject: (error) => settle(() => reject(error)),
      };
      this.pending.set(id, pending);

      const timeoutMs =
        options?.timeoutMs !== undefined ? options.timeoutMs : DEFAULT_WS_REQUEST_TIMEOUT_MS;
      if (timeoutMs !== null) {
        if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          pending.reject(
            new WsRequestError(
              "timeout",
              `Invalid timeoutMs: ${timeoutMs}; must be a positive number or null`,
              method
            )
          );
          return;
        }
        timer = setTimeout(() => {
          pending.reject(
            new WsRequestError(
              "timeout",
              `${method} timed out after ${timeoutMs}ms; outcome unknown`,
              method
            )
          );
        }, timeoutMs);
      }

      if (fence) {
        abortListener = () => {
          pending.reject(new WsRequestError("aborted", "WS request aborted", method));
        };
        fence.signal.addEventListener("abort", abortListener, { once: true });
        if (fence.signal.aborted) {
          abortListener();
          return;
        }
      }

      try {
        const req: WsReq<P> = { type: "req", version: "v1", id, method, params };
        this.ws.send(JSON.stringify(req));
      } catch (err) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
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
    const oldPending = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of oldPending) {
      pending.reject(new WsRequestError("disconnected", "WS disconnected"));
    }
    this.notifyStatus("offline");
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
