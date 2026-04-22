import { WsClient } from "./WsClient.js";
import type { IChatService, StreamEventCallback } from "../factory/interfaces/IChatService.js";
import type {
  ConnectResponse,
  ChatSendResponse,
  ChatHistoryResponse,
} from "@nonclaw-ui/shared/types";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";
import { useConnectionStore } from "../../stores/connectionStore.js";

export class WsChatAdapter implements IChatService {
  private readonly client: WsClient;
  private token: string | undefined;

  constructor(wsUrl: string) {
    this.client = new WsClient(wsUrl);
    // After an automatic reconnect, re-authenticate and publish the new session ID
    // so the UI and future sendMessage calls use the current session.
    this.client.onReconnect(async () => {
      try {
        const conn = await this.authenticate();
        useConnectionStore.getState().setSessionId(conn.session_id);
      } catch (err) {
        console.warn("[WsChatAdapter] re-auth failed:", err);
      }
    });
  }

  async connect(token?: string): Promise<ConnectResponse> {
    this.token = token;
    await this.client.connect();
    return this.authenticate();
  }

  private async authenticate(): Promise<ConnectResponse> {
    const res = await this.client.send<{ token?: string }, ConnectResponse>(
      WS_METHODS.CONNECT,
      this.token ? { token: this.token } : {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "connect failed");
    return res.data!;
  }

  async sendMessage(
    message: string,
    sessionId: string | undefined,
    onEvent: StreamEventCallback
  ): Promise<ChatSendResponse> {
    this.client.onEvent(onEvent);
    try {
      const res = await this.client.send<object, ChatSendResponse>(WS_METHODS.CHAT_SEND, {
        message,
        stream: true,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      if (!res.ok) throw new Error(res.error?.message ?? "chat.send failed");
      return res.data!;
    } finally {
      this.client.removeEventHandler(onEvent);
    }
  }

  async getHistory(sessionId?: string): Promise<ChatHistoryResponse> {
    const res = await this.client.send<object, ChatHistoryResponse>(
      WS_METHODS.CHAT_HISTORY,
      sessionId ? { session_id: sessionId } : {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "chat.history failed");
    return res.data!;
  }

  async abort(): Promise<void> {
    await this.client.send(WS_METHODS.CHAT_ABORT, {});
  }

  disconnect() {
    this.client.disconnect();
  }
}
