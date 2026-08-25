import type {
  ChatHistoryResponse,
  ChatSendResponse,
  ConnectResponse,
  RunLifecycleStatus,
  UserQuestionUpdatedEvent,
  WsEvent,
} from "@nonclaw-ui/shared/types";

export type StreamEventCallback = (event: WsEvent) => void;
/** Correlation-only event: no payload/debug is retained by the Runs bridge. */
export type RunCorrelationEvent = Pick<
  WsEvent,
  "event" | "run_id" | "event_id" | "event_seq" | "occurred_at_ms"
> & { lifecycle_status?: RunLifecycleStatus };

export type RunCorrelationSignal = RunCorrelationEvent & {
  /** Metadata-only recovery hint for legacy frames that cannot name a run. */
  snapshot_refetch_required?: boolean;
};

export type RunCorrelationCallback = (event: RunCorrelationSignal) => void;
export type UserQuestionEventCallback = (event: UserQuestionUpdatedEvent) => void;

export interface DebugRequestOptions {
  includePrompt: boolean;
  includeReasoning: boolean;
}

export interface SendMessageOptions {
  selectedSkillId?: string;
  allowToolLimitContinue?: boolean;
  debug?: DebugRequestOptions;
}

export interface IChatService {
  connect(token?: string): Promise<ConnectResponse>;
  sendMessage(
    message: string,
    sessionId: string | undefined,
    onEvent: StreamEventCallback,
    options?: SendMessageOptions
  ): Promise<ChatSendResponse>;
  getHistory(
    sessionId?: string,
    debug?: DebugRequestOptions
  ): Promise<ChatHistoryResponse>;
  abort(): Promise<void>;
  disconnect(): void;
  subscribeRunCorrelation?(callback: RunCorrelationCallback): () => void;
  onRunReconnect?(callback: () => void): () => void;
  subscribeUserQuestion?(callback: UserQuestionEventCallback): () => void;
  onQuestionProtocolError?(callback: () => void): () => void;
}
