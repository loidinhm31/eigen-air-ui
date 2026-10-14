import type {
  ChatHistoryResponse,
  ChatSendResponse,
  ConnectResponse,
  RunLifecycleStatus,
  UserQuestionUpdatedEvent,
  ImageHintWsEvent,
  ToolApprovalUpdatedEvent,
  TaskProgressWsEvent,
  WsEvent,
} from "@eigen-air-ui/shared/types";

export type StreamEventCallback = (event: WsEvent) => void;
/** Correlation-only event: no payload/debug is retained by the Runs bridge. */
export type RunCorrelationEvent = Pick<
  WsEvent,
  "event" | "run_id" | "event_id" | "event_seq" | "occurred_at_ms"
> & { lifecycle_status?: RunLifecycleStatus; session_id?: string };

export type RunCorrelationSignal = RunCorrelationEvent & {
  /** Metadata-only recovery hint for legacy frames that cannot name a run. */
  snapshot_refetch_required?: boolean;
};

export type RunCorrelationCallback = (event: RunCorrelationSignal) => void;
export type UserQuestionEventCallback = (event: UserQuestionUpdatedEvent) => void;
export type ToolApprovalEventCallback = (event: ToolApprovalUpdatedEvent) => void;
export type TaskProgressEventCallback = (event: TaskProgressWsEvent) => void;
/**
 * Malformed image hint, or ANY undecodable frame (it may have been a hint). Carries no payload.
 * A misbehaving peer can emit these without bound.
 */
export interface InvalidImageHintSignal {
  invalid: true;
}
/**
 * Metadata-only refetch hint. NEVER authority: consumers refetch the authorized REST snapshot
 * on every hint (valid or invalid) and ignore hints whose scope is not the current session.
 */
export type ImageHintSignal = ImageHintWsEvent | InvalidImageHintSignal;
export type ImageHintCallback = (hint: ImageHintSignal) => void;
export interface DebugRequestOptions {
  includePrompt: boolean;
  includeReasoning: boolean;
}

export interface SendMessageOptions {
  selectedSkillId?: string;
  selectedSkillInstallId?: string;
  selectedSkillContentRevision?: string;
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
  subscribeToolApproval?(callback: ToolApprovalEventCallback): () => void;
  onToolApprovalProtocolError?(callback: () => void): () => void;
  subscribeTaskProgress?(callback: TaskProgressEventCallback): () => void;
  /**
   * Metadata-only image refetch hints; returns unsubscribe. Decoded hints go to every subscriber
   * and never reach the per-turn `sendMessage` stream callback. `{ invalid: true }` is signalled
   * for malformed hints and for undecodable frames alike, so consumers MUST coalesce/debounce
   * the refetch they trigger (an unbounded invalid-frame stream must not become unbounded
   * REST calls). A subscriber that throws is isolated: later subscribers and frames still run.
   */
  onImageHint?(handler: ImageHintCallback): () => void;
}
