export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export type ConnectionErrorKind =
  | "unauthenticated"
  | "unsupported_daemon"
  | "timeout"
  | "unreachable";

export interface ConnectionState {
  url: string;
  status: ConnectionStatus;
  version?: string;
  sessionId?: string;
  error?: ConnectionErrorKind;
}
