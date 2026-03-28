import type {
  ConnectResponse,
  ChatSendResponse,
  ChatHistoryResponse,
  WsEvent,
} from "@nonclaw-ui/shared/types";

export type StreamEventCallback = (event: WsEvent) => void;

export interface IChatService {
  connect(token?: string): Promise<ConnectResponse>;
  sendMessage(
    message: string,
    sessionId: string | undefined,
    onEvent: StreamEventCallback
  ): Promise<ChatSendResponse>;
  getHistory(sessionId?: string): Promise<ChatHistoryResponse>;
  abort(): Promise<void>;
  disconnect(): void;
}
