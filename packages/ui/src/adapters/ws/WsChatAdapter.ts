import { WsClient } from "./WsClient.js";
import type {
  DebugRequestOptions,
  IChatService,
  SendMessageOptions,
  StreamEventCallback,
  RunCorrelationCallback,
  RunCorrelationSignal,
} from "../factory/interfaces/IChatService.js";
import type { ISessionService } from "../factory/interfaces/ISessionService.js";
import type {
  ChatAbortParams,
  ChatHistoryParams,
  ChatHistoryResponse,
  ChatSendParams,
  ChatSendResponse,
  ConnectResponse,
  DebugRequest,
  SessionsCreateResponse,
  SessionsDeleteParams,
  SessionsDeleteResponse,
  SessionsListResponse,
  WsEvent,
} from "@nonclaw-ui/shared/types";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";
import { useConnectionStore } from "../../stores/connectionStore.js";

export function buildDebugRequest(
  debug?: DebugRequestOptions
): DebugRequest | undefined {
  if (!debug || (!debug.includePrompt && !debug.includeReasoning)) {
    return undefined;
  }
  return {
    include_prompt: debug.includePrompt,
    include_reasoning: debug.includeReasoning,
  };
}

export function buildChatSendParams(
  message: string,
  sessionId: string | undefined,
  options: SendMessageOptions = {}
): ChatSendParams {
  const debug = buildDebugRequest(options.debug);
  return {
    message,
    stream: true,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(options.selectedSkillId !== undefined
      ? { selected_skill_id: options.selectedSkillId }
      : {}),
    ...(options.allowToolLimitContinue ? { allow_tool_limit_continue: true } : {}),
    ...(debug ? { debug } : {}),
  };
}

export function projectRunCorrelation(event: WsEvent): RunCorrelationSignal | undefined {
  const snapshotRefetchRequired =
    "snapshot_refetch_required" in event.payload &&
    event.payload.snapshot_refetch_required === true;
  if (!event.run_id && !snapshotRefetchRequired) return undefined;
  const lifecycle = "lifecycle_status" in event.payload
    ? event.payload.lifecycle_status
    : undefined;
  return {
    event: event.event,
    run_id: event.run_id,
    event_id: event.event_id,
    event_seq: event.event_seq,
    occurred_at_ms: event.occurred_at_ms,
    ...(lifecycle ? { lifecycle_status: lifecycle } : {}),
    ...(snapshotRefetchRequired ? { snapshot_refetch_required: true } : {}),
  };
}

export class WsChatAdapter implements IChatService, ISessionService {
  private readonly client: WsClient;
  private token: string | undefined;
  private activeRunId: string | undefined;
  private readonly runSubscribers = new Set<RunCorrelationCallback>();
  private readonly reconnectSubscribers = new Set<() => void>();

  constructor(wsUrl: string) {
    this.client = new WsClient(wsUrl);
    this.client.onEvent((event) => this.forwardRunCorrelation(event));
    this.client.onReconnect(async () => {
      try {
        await this.connect(this.token);
        this.reconnectSubscribers.forEach((callback) => callback());
      } catch (err) {
        console.warn("[WsChatAdapter] re-auth failed:", err);
      }
    });
  }

  subscribeRunCorrelation(callback: RunCorrelationCallback): () => void {
    this.runSubscribers.add(callback);
    return () => this.runSubscribers.delete(callback);
  }

  onRunReconnect(callback: () => void): () => void {
    this.reconnectSubscribers.add(callback);
    return () => this.reconnectSubscribers.delete(callback);
  }

  private forwardRunCorrelation(event: WsEvent): void {
    // Deliberately project metadata only; debug/content/tool payloads never enter a replay buffer.
    const projected = projectRunCorrelation(event);
    if (!projected) return;
    this.runSubscribers.forEach((callback) => callback(projected));
  }

  async connect(token?: string): Promise<ConnectResponse> {
    this.token = token;
    await this.client.connect();
    const connection = await this.authenticate();
    return this.resolveSelectedSession(connection);
  }

  private async authenticate(): Promise<ConnectResponse> {
    const res = await this.client.send<{ token?: string }, ConnectResponse>(
      WS_METHODS.CONNECT,
      this.token ? { token: this.token } : {}
    );
    if (!res.ok) throw new Error(res.error?.message ?? "connect failed");
    return res.data!;
  }

  private async resolveSelectedSession(connection: ConnectResponse): Promise<ConnectResponse> {
    const { sessionId, setSessionId } = useConnectionStore.getState();
    const sessions = await this.listSessions();
    const selected = sessionId
      ? sessions.find((candidate) => candidate.id === sessionId)
      : undefined;
    const activeSession = selected ?? (await this.createSession());
    setSessionId(activeSession.id);
    return {
      ...connection,
      session_id: activeSession.id,
    };
  }

  async sendMessage(
    message: string,
    sessionId: string | undefined,
    onEvent: StreamEventCallback,
    options: SendMessageOptions = {}
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
      const params = buildChatSendParams(message, sessionId, options);
      const res = await this.client.send<ChatSendParams, ChatSendResponse>(
        WS_METHODS.CHAT_SEND,
        params
      );
      if (!res.ok) throw new Error(res.error?.message ?? "chat.send failed");
      return res.data!;
    } finally {
      this.activeRunId = undefined;
      this.client.removeEventHandler(handler);
    }
  }

  async getHistory(
    sessionId?: string,
    debugOptions?: DebugRequestOptions
  ): Promise<ChatHistoryResponse> {
    const debug = buildDebugRequest(debugOptions);
    const params: ChatHistoryParams = {
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(debug ? { debug } : {}),
    };
    const res = await this.client.send<ChatHistoryParams, ChatHistoryResponse>(
      WS_METHODS.CHAT_HISTORY,
      params
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
