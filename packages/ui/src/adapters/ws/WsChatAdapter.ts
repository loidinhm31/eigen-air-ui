import { WsClient, type WsReconnectFence } from "./WsClient.js";
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
  UserQuestionUpdatedEvent,
  ToolApprovalUpdatedEvent,
} from "@nonclaw-ui/shared/types";
import { decodeChatHistoryResponse, decodeChatSendResponse } from "@nonclaw-ui/shared/types";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";
import { useConnectionStore } from "../../stores/connectionStore.js";

type WsAccessProvider = () => { authToken?: string };

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
    ...(event.session_id ? { session_id: event.session_id } : {}),
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
  private readonly questionSubscribers = new Set<(event: UserQuestionUpdatedEvent) => void>();
  private readonly approvalSubscribers = new Set<(event: ToolApprovalUpdatedEvent) => void>();
  private readonly approvalProtocolSubscribers = new Set<() => void>();
  private readonly questionProtocolSubscribers = new Set<() => void>();
  private readonly waitingHandlers = new Set<(event: WsEvent) => void>();
  private readonly accessProvider?: WsAccessProvider;

  constructor(wsUrl: string, accessProvider?: WsAccessProvider) {
    this.accessProvider = accessProvider;
    this.client = new WsClient(wsUrl);
    this.client.onEvent((event) => {
      if (event.event === "tool_approval.updated") {
        this.approvalSubscribers.forEach((callback) => callback(event));
      }
      if (event.event === "user_question.updated") {
        this.questionSubscribers.forEach((callback) => callback(event));
      }
      this.forwardRunCorrelation(event);
    });
    this.client.onConnectionStatus((status) => {
      if (status === "reconnecting") useConnectionStore.getState().setStatus("connecting");
      if (status === "offline") useConnectionStore.getState().setStatus("disconnected");
      if (status === "connected") useConnectionStore.getState().setStatus("connected");
    });
    this.client.onProtocolError(() => {
      this.questionProtocolSubscribers.forEach((callback) => callback());
      this.approvalProtocolSubscribers.forEach((callback) => callback());
    });
    this.client.onReconnect(async (fence) => {
      try {
        const connection = await this.authenticateAndResolveSession(fence);
        this.assertReconnectFence(fence);
        useConnectionStore.getState().setStatus("connected", connection.version);
        this.reconnectSubscribers.forEach((callback) => callback());
      } catch {
        throw new Error("re-authentication failed");
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

  subscribeUserQuestion(callback: (event: UserQuestionUpdatedEvent) => void): () => void {
    this.questionSubscribers.add(callback);
    return () => this.questionSubscribers.delete(callback);
  }

  subscribeToolApproval(callback: (event: ToolApprovalUpdatedEvent) => void): () => void {
    this.approvalSubscribers.add(callback);
    return () => this.approvalSubscribers.delete(callback);
  }

  onToolApprovalProtocolError(callback: () => void): () => void {
    this.approvalProtocolSubscribers.add(callback);
    return () => this.approvalProtocolSubscribers.delete(callback);
  }

  onQuestionProtocolError(callback: () => void): () => void {
    this.questionProtocolSubscribers.add(callback);
    return () => this.questionProtocolSubscribers.delete(callback);
  }

  private forwardRunCorrelation(event: WsEvent): void {
    // Deliberately project metadata only; debug/content/tool payloads never enter a replay buffer.
    const projected = projectRunCorrelation(event);
    if (!projected) return;
    this.runSubscribers.forEach((callback) => callback(projected));
  }

  async connect(token?: string): Promise<ConnectResponse> {
    this.token = token ?? this.accessProvider?.().authToken;
    try {
      await this.client.connect();
      return await this.authenticateAndResolveSession();
    } catch (error) {
      // Authentication failure must not leave an unauthenticated socket alive.
      this.client.disconnect();
      throw error;
    }
  }

  private assertReconnectFence(fence?: WsReconnectFence): void {
    if (fence?.signal.aborted) throw new Error("reconnect superseded");
  }

  private async authenticateAndResolveSession(
    fence?: WsReconnectFence
  ): Promise<ConnectResponse> {
    const connection = await this.authenticate(fence);
    this.assertReconnectFence(fence);
    return this.resolveSelectedSession(connection, fence);
  }

  private async authenticate(fence?: WsReconnectFence): Promise<ConnectResponse> {
    if (fence && this.accessProvider) {
      this.token = this.accessProvider().authToken;
    } else if (this.token === undefined && this.accessProvider) {
      this.token = this.accessProvider().authToken;
    }
    const res = await this.client.send<{ token?: string }, ConnectResponse>(
      WS_METHODS.CONNECT,
      this.token ? { token: this.token } : {},
      fence
    );
    if (!res.ok) throw new Error(res.error?.message ?? "connect failed");
    return res.data!;
  }

  private async resolveSelectedSession(
    connection: ConnectResponse,
    fence?: WsReconnectFence
  ): Promise<ConnectResponse> {
    const { sessionId, setSessionId } = useConnectionStore.getState();
    const sessions = await this.listSessions(fence);
    const selected = sessionId
      ? sessions.find((candidate) => candidate.id === sessionId)
      : undefined;
    const activeSession = selected ?? (await this.createSession(fence));
    this.assertReconnectFence(fence);
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
    this.clearWaitingHandlers();
    let waitingForInput = false;
    let terminalSeen = false;
    let waitingQuestionId: string | undefined;
    let keepHandler = false;
    const handler = (event: WsEvent) => {
      if (event.event === "run.started") {
        this.activeRunId = event.payload.run_id;
      } else if (event.event === "run.finished" || event.event === "run.completed") {
        this.activeRunId = undefined;
        terminalSeen = true;
      } else if (event.event === "error") {
        this.activeRunId = undefined;
        terminalSeen = true;
      }
      if (
        waitingForInput &&
        waitingQuestionId !== undefined &&
        event.event === "user_question.updated" &&
        event.payload.question_id === waitingQuestionId &&
        ["cancelled", "expired", "aborted", "failed", "resolved"].includes(event.payload.state)
      ) {
        terminalSeen = true;
      }
      onEvent(event);
      if (terminalSeen && waitingForInput) {
        keepHandler = false;
        this.client.removeEventHandler(handler);
        this.waitingHandlers.delete(handler);
      }
    };

    this.client.onEvent(handler);
    try {
      const params = buildChatSendParams(message, sessionId, options);
      const res = await this.client.send<ChatSendParams, ChatSendResponse>(
        WS_METHODS.CHAT_SEND,
        params
      );
      if (!res.ok) throw new Error(res.error?.message ?? "chat.send failed");
      const result = decodeChatSendResponse(res.data);
      if ("status" in result && result.status === "waiting_for_input") {
        waitingForInput = true;
        waitingQuestionId = result.question_id;
        keepHandler = !terminalSeen;
        if (keepHandler) this.waitingHandlers.add(handler);
        else this.client.removeEventHandler(handler);
      }
      return result;
    } finally {
      this.activeRunId = undefined;
      if (!keepHandler) {
        this.client.removeEventHandler(handler);
        this.waitingHandlers.delete(handler);
      }
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
    return decodeChatHistoryResponse(res.data);
  }

  async abort(): Promise<void> {
    const params: ChatAbortParams = this.activeRunId ? { run_id: this.activeRunId } : {};
    await this.client.send<ChatAbortParams>(WS_METHODS.CHAT_ABORT, params);
  }

  async listSessions(fence?: WsReconnectFence): Promise<SessionsListResponse["sessions"]> {
    const res = await this.client.send<object, SessionsListResponse>(
      WS_METHODS.SESSIONS_LIST,
      {},
      fence
    );
    if (!res.ok) throw new Error(res.error?.message ?? "sessions.list failed");
    return res.data!.sessions;
  }

  async createSession(fence?: WsReconnectFence): Promise<SessionsCreateResponse> {
    const res = await this.client.send<object, SessionsCreateResponse>(
      WS_METHODS.SESSIONS_CREATE,
      {},
      fence
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
    this.clearWaitingHandlers();
    this.client.disconnect();
  }

  private clearWaitingHandlers(): void {
    for (const handler of this.waitingHandlers) this.client.removeEventHandler(handler);
    this.waitingHandlers.clear();
  }
}
