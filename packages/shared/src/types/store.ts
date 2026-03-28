export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export interface ConnectionState {
  url: string;
  status: ConnectionStatus;
  version?: string;
  sessionId?: string;
}
