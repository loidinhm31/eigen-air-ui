import { WsClient, type WsReconnectFence, type WsSendOptions } from "./WsClient.js";
import { WsRequestError, isWsRequestError } from "./ws-request-error.js";
import type {
  DebugRequestOptions,
  ImageHintCallback,
  ImageHintSignal,
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
  ExecutionTargetInput,
  Session,
  SessionsCreateParams,
  SessionsCreateResponse,
  SessionsDeleteParams,
  SessionsDeleteResponse,
  SessionsGetParams,
  SessionsGetResponse,
  SessionsListParams,
  SessionsListResponse,
  WsEvent,
  ImageHintWsEvent,
  UserQuestionUpdatedEvent,
  ToolApprovalUpdatedEvent,
  TaskProgressWsEvent,
} from "@eigen-air-ui/shared/types";
import {
  decodeChatHistoryResponse,
  decodeChatSendResponse,
  isImageHintEventName,
} from "@eigen-air-ui/shared/types";
import { WS_METHODS } from "@eigen-air-ui/shared/constants";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

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
    ...(options.selectedSkillInstallId !== undefined
      ? { selected_skill_install_id: options.selectedSkillInstallId }
      : {}),
    ...(options.selectedSkillContentRevision !== undefined
      ? { selected_skill_content_revision: options.selectedSkillContentRevision }
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
  private retired = false;
  private readonly runSubscribers = new Set<RunCorrelationCallback>();
  private readonly reconnectSubscribers = new Set<() => void>();
  private readonly questionSubscribers = new Set<(event: UserQuestionUpdatedEvent) => void>();
  private readonly approvalSubscribers = new Set<(event: ToolApprovalUpdatedEvent) => void>();
  private readonly approvalProtocolSubscribers = new Set<() => void>();
  private readonly questionProtocolSubscribers = new Set<() => void>();
  private readonly taskProgressSubscribers = new Set<(event: TaskProgressWsEvent) => void>();
  private readonly imageHintSubscribers = new Set<ImageHintCallback>();
  private readonly waitingHandlers = new Set<(event: WsEvent) => void>();
  private readonly accessProvider?: WsAccessProvider;

  constructor(wsUrl: string, accessProvider?: WsAccessProvider) {
    this.accessProvider = accessProvider;
    this.client = new WsClient(wsUrl);
    this.client.onEvent((event) => {
      if (isImageHintEventName(event.event)) {
        // Hints are metadata-only refetch signals: never authority, not run lifecycle, so they
        // skip run correlation and mutate no store here.
        this.notifyImageHint(event as ImageHintWsEvent);
        return;
      }
      if (event.event === "tool_approval.updated") {
        this.approvalSubscribers.forEach((callback) => callback(event));
      }
      if (event.event === "user_question.updated") {
        this.questionSubscribers.forEach((callback) => callback(event));
      }
      if (event.event === "task_progress.updated") {
        this.taskProgressSubscribers.forEach((callback) => callback(event as TaskProgressWsEvent));
      }
      if (event.event === "inference.host.updated") {
        useInferenceStore.getState().applyHostUpdatedEvent(event.payload);
      }
      if (event.event === "inference.binding.updated") {
        useInferenceStore.getState().applyBindingUpdatedEvent(event.payload);
      }
      if (event.event === "inference.pool.updated") {
        useInferenceStore.getState().applyPoolUpdatedEvent(event.payload);
      }
      if (event.event === "inference.recovery.updated") {
        useInferenceStore.getState().applyRecoveryUpdatedEvent(event.payload);
      }
      if (event.event === "inference.operation.updated") {
        useInferenceStore.getState().applyOperationEvent(event.payload);
      }
      if (event.event === "run.inference.progress") {
        useInferenceStore.getState().applyRunProgressEvent(event.payload);
      }
      this.forwardRunCorrelation(event);
    });
    this.client.onInvalidImageHint(() => this.notifyImageHint({ invalid: true }));
    this.client.onConnectionStatus((status) => {
      if (this.retired) return;
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
        if (this.retired) return;
        useConnectionStore.getState().setStatus("connected", connection.version);
        this.reconnectSubscribers.forEach((callback) => callback());
        // Reconcile gap snapshot after reconnect
        const store = useInferenceStore.getState();
        void store.fetchHosts();
        void store.fetchPools();
        void store.fetchCredentialRecoveries();
        if (store.activeInstallationId) {
          void store.fetchInstallation(store.activeInstallationId);
        }
        void store.reconcilePersistedMutations();
        const activeOps = Object.values(store.operations).filter(
          (op) =>
            op.status === "active" ||
            op.status === "pending" ||
            op.state === "running" ||
            op.state === "queued" ||
            op.state === "cancelling"
        );
        for (const op of activeOps) {
          void store.pollActiveOperation(op.operation_id);
        }
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

  subscribeTaskProgress(callback: (event: TaskProgressWsEvent) => void): () => void {
    this.taskProgressSubscribers.add(callback);
    return () => this.taskProgressSubscribers.delete(callback);
  }

  /**
   * Subscribe to image hints (decoded) and `{ invalid: true }` for malformed/undecodable ones.
   * Undecodable frames also signal invalid, so a misbehaving peer can fire it unboundedly:
   * consumers MUST coalesce/debounce the refetch it triggers. A throwing subscriber is isolated.
   */
  onImageHint(callback: ImageHintCallback): () => void {
    this.imageHintSubscribers.add(callback);
    return () => this.imageHintSubscribers.delete(callback);
  }

  /** Delivers to every subscriber; one throwing subscriber never skips the rest or the stream. */
  private notifyImageHint(signal: ImageHintSignal): void {
    this.imageHintSubscribers.forEach((callback) => {
      try {
        callback(signal);
      } catch {
        // Isolated by design; the error text is never logged (hint consumers are store-fed).
      }
    });
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

  async connect(token?: string, options?: { signal?: AbortSignal }): Promise<ConnectResponse> {
    this.retired = false;
    this.assertSignal(options?.signal);
    this.token = token ?? this.accessProvider?.().authToken;
    try {
      await this.client.connect();
      this.assertSignal(options?.signal);
      return await this.authenticateAndResolveSession(undefined, options?.signal);
    } catch (error) {
      // Authentication failure must not leave an unauthenticated socket alive.
      // However, an aborted/superseded connect must not tear down a socket that might have been
      // superseded or reopened by a newer connect attempt on this adapter.
      if (!options?.signal?.aborted && !isWsRequestError(error, "superseded")) {
        this.client.disconnect();
      }
      throw error;
    }
  }

  private async call<P, D>(
    method: string,
    params: P,
    options?: WsSendOptions
  ): Promise<D> {
    const res = await this.client.send<P, D>(method, params, options);
    if (!res.ok) {
      throw new WsRequestError(
        res.error?.code ?? "request_failed",
        res.error?.message ?? `${method} failed`,
        method
      );
    }
    return res.data!;
  }

  private assertReconnectFence(fence?: WsReconnectFence): void {
    if (fence?.signal.aborted) throw new Error("reconnect superseded");
  }
  private assertSignal(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new WsRequestError("superseded", "connect superseded", WS_METHODS.CONNECT);
    }
  }


  private async authenticateAndResolveSession(
    fence?: WsReconnectFence,
    signal?: AbortSignal
  ): Promise<ConnectResponse> {
    const connection = await this.authenticate(fence, signal);
    this.assertReconnectFence(fence);
    this.assertSignal(signal);
    return this.resolveSelectedSession(connection, fence, signal);
  }

  private async authenticate(
    fence?: WsReconnectFence,
    signal?: AbortSignal
  ): Promise<ConnectResponse> {
    this.assertReconnectFence(fence);
    this.assertSignal(signal);
    if (fence && this.accessProvider) {
      this.token = this.accessProvider().authToken;
    } else if (this.token === undefined && this.accessProvider) {
      this.token = this.accessProvider().authToken;
    }
    const res = await this.call<{ token?: string }, ConnectResponse>(
      WS_METHODS.CONNECT,
      this.token ? { token: this.token } : {},
      { fence }
    );
    this.assertReconnectFence(fence);
    this.assertSignal(signal);
    return res;
  }

  private async resolveSelectedSession(
    connection: ConnectResponse,
    fence?: WsReconnectFence,
    signal?: AbortSignal
  ): Promise<ConnectResponse> {
    const { sessionId, setSessionId } = useConnectionStore.getState();
    const selected = sessionId ? await this.getSession(sessionId, fence) : null;
    this.assertReconnectFence(fence);
    this.assertSignal(signal);
    const activeSession = selected ?? (await this.createSession(undefined, fence));
    this.assertReconnectFence(fence);
    this.assertSignal(signal);
    if (this.retired) {
      throw new WsRequestError("superseded", "connect superseded", WS_METHODS.CONNECT);
    }
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
      // Hints are for `onImageHint` subscribers only; the per-turn stream never sees them.
      if (isImageHintEventName(event.event)) return;
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
      const data = await this.call<ChatSendParams, ChatSendResponse>(
        WS_METHODS.CHAT_SEND,
        params,
        { timeoutMs: null }
      );
      const result = decodeChatSendResponse(data);
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
    const data = await this.call<ChatHistoryParams, ChatHistoryResponse>(
      WS_METHODS.CHAT_HISTORY,
      params
    );
    return decodeChatHistoryResponse(data);
  }

  async abort(): Promise<void> {
    const params: ChatAbortParams = this.activeRunId ? { run_id: this.activeRunId } : {};
    await this.call<ChatAbortParams, unknown>(WS_METHODS.CHAT_ABORT, params);
  }

  async listSessions(
    queryOrFence?: SessionsListParams | WsReconnectFence,
    maybeFence?: WsReconnectFence
  ): Promise<SessionsListResponse> {
    const isFence =
      queryOrFence && typeof queryOrFence === "object" && "signal" in queryOrFence && "epoch" in queryOrFence;
    const query: SessionsListParams = isFence ? {} : (queryOrFence as SessionsListParams) ?? {};
    const fence: WsReconnectFence | undefined = isFence
      ? (queryOrFence as WsReconnectFence)
      : maybeFence;
    return this.call<SessionsListParams, SessionsListResponse>(
      WS_METHODS.SESSIONS_LIST,
      query,
      { fence }
    );
  }

  async getSession(id: string, fence?: WsReconnectFence): Promise<Session | null> {
    try {
      const data = await this.call<SessionsGetParams, SessionsGetResponse>(
        WS_METHODS.SESSIONS_GET,
        { id },
        { fence }
      );
      return data.session;
    } catch (err: unknown) {
      if (isWsRequestError(err, "not_found")) {
        return null;
      }
      if (isWsRequestError(err, "method_not_found")) {
        throw new WsRequestError(
          "unsupported_daemon",
          "Daemon does not support sessions.get; upgrade the daemon",
          WS_METHODS.SESSIONS_GET
        );
      }
      throw err;
    }
  }

  async createSession(
    targetOrFence?: ExecutionTargetInput | WsReconnectFence,
    maybeFence?: WsReconnectFence
  ): Promise<SessionsCreateResponse> {
    const target: ExecutionTargetInput | undefined =
      targetOrFence && typeof targetOrFence === "object" && "kind" in targetOrFence
        ? (targetOrFence as ExecutionTargetInput)
        : undefined;
    const fence: WsReconnectFence | undefined =
      targetOrFence && typeof targetOrFence === "object" && !("kind" in targetOrFence)
        ? (targetOrFence as WsReconnectFence)
        : maybeFence;

    const params: SessionsCreateParams = target
      ? { inference_target: target, execution_target: target }
      : {};
    return this.call<SessionsCreateParams, SessionsCreateResponse>(
      WS_METHODS.SESSIONS_CREATE,
      params,
      { fence }
    );
  }

  async deleteSession(id: string): Promise<boolean> {
    const data = await this.call<SessionsDeleteParams, SessionsDeleteResponse>(
      WS_METHODS.SESSIONS_DELETE,
      { id }
    );
    return data.deleted;
  }

  disconnect() {
    this.retired = true;
    this.clearWaitingHandlers();
    this.client.disconnect();
  }

  private clearWaitingHandlers(): void {
    for (const handler of this.waitingHandlers) this.client.removeEventHandler(handler);
    this.waitingHandlers.clear();
  }
}
