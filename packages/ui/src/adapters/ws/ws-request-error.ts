export type WsTransportErrorCode =
  | "timeout"
  | "invalid_response"
  | "protocol_desync"
  | "connection_closed"
  | "connection_replaced"
  | "disconnected"
  | "not_connected"
  | "superseded"
  | "aborted";

export class WsRequestError extends Error {
  constructor(
    readonly code: WsTransportErrorCode | (string & {}),
    message: string,
    readonly method?: string
  ) {
    super(message);
    this.name = "WsRequestError";
  }
}

export function isWsRequestError(error: unknown, code?: string): error is WsRequestError {
  if (!(error instanceof WsRequestError)) return false;
  return code === undefined || error.code === code;
}
