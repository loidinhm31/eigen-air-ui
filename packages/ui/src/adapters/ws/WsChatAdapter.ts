import { WsClient } from "./WsClient.js";
import type { IChatService, StreamEventCallback } from "../factory/interfaces/IChatService.js";
import type { ISessionService } from "../factory/interfaces/ISessionService.js";
import type {
  ChatAbortParams,
  ConnectResponse,
  ChatSendResponse,
  ChatHistoryResponse,
  SessionsCreateResponse,
  SessionsDeleteParams,
  SessionsDeleteResponse,
  SessionsListResponse,
  WsEvent,
} from "@nonclaw-ui/shared/types";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";
import { useConnectionStore } from "../../stores/connectionStore.js";

export class WsChatAdapter implements IChatService, ISessionService {
  private readonly client: WsClient;
  private token: string | undefined;
  private activeRunId: string | undefined;

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
    const handler = (event: WsEvent) => {
      if (event.event === "run.started") {
        this.activeRunId = event.payload.run_id;
      } else if (event.event === "run.finished" || event.event === "run.completed") {
        this.activeRunId = undefined;
      } else if (event.event === "error") {
        this.activeRunId = undefined;
      }
      onEvent(event);
    };

    this.client.onEvent(handler);
    try {
      const res = await this.client.send<object, ChatSendResponse>(WS_METHODS.CHAT_SEND, {
        message,
        stream: true,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      if (!res.ok) throw new Error(res.error?.message ?? "chat.send failed");
      return res.data!;
    } finally {
      this.activeRunId = undefined;
      this.client.removeEventHandler(handler);
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
    const params: ChatAbortParams = this.activeRunId ? { run_id: this.activeRunId } : {};
    await this.client.send<ChatAbortParams>(WS_METHODS.CHAT_ABORT, params);
  }

  async listSessions(): Promise<SessionsListResponse["sessions"]> {
    const res = await this.client.send<object, SessionsListResponse>(
      WS_METHODS.SESSIONS_LIST,
      {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "sessions.list failed");
    return res.data!.sessions;
  }

  async createSession(): Promise<SessionsCreateResponse> {
    const res = await this.client.send<object, SessionsCreateResponse>(
      WS_METHODS.SESSIONS_CREATE,
      {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "sessions.create failed");
    return res.data!;
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await this.client.send<SessionsDeleteParams, SessionsDeleteResponse>(
      WS_METHODS.SESSIONS_DELETE,
      { id }
    );
    if (!res.ok) throw new Error(res.error?.message ?? "sessions.delete failed");
    return res.data!.deleted;
  }

  disconnect() {
    this.client.disconnect();
  }
}
