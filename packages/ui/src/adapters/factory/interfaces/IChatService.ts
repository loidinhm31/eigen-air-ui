import type {
  ConnectResponse,
  ChatSendResponse,
  ChatHistoryResponse,
  WsEvent,
} from "@nonclaw-ui/shared/types";

export type StreamEventCallback = (event: WsEvent) => void;

export interface SendMessageOptions {
  selectedSkillId?: string;
}

export interface IChatService {
  connect(token?: string): Promise<ConnectResponse>;
  sendMessage(
    message: string,
    sessionId: string | undefined,
    onEvent: StreamEventCallback,
    options?: SendMessageOptions
  ): Promise<ChatSendResponse>;
  getHistory(sessionId?: string): Promise<ChatHistoryResponse>;
  abort(): Promise<void>;
  disconnect(): void;
}
