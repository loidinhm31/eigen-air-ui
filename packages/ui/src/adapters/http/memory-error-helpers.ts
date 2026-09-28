export type MemoryHttpErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "sensitive_content"
  | "conflict"
  | "invalid"
  | "server_error"
  | "network_error"
  | "aborted";

export class MemoryHttpError extends Error {
  readonly kind: MemoryHttpErrorKind;
  readonly status: number;
  readonly code?: string;

  constructor(status: number, kind: MemoryHttpErrorKind, message?: string, code?: string) {
    super(message ?? defaultMessageForKind(kind));
    this.name = "MemoryHttpError";
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

export function defaultMessageForKind(kind: MemoryHttpErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "Authentication required";
    case "forbidden":
      return "Access denied to memory resource";
    case "not_found":
      return "Memory source unavailable";
    case "sensitive_content":
      return "Sensitive transcript edits are rejected";
    case "conflict":
      return "Memory resource conflicted";
    case "invalid":
      return "Invalid memory request";
    case "server_error":
      return "Memory service unavailable";
    case "network_error":
      return "Network communication failed";
    case "aborted":
      return "Memory request was cancelled";
  }
}

export function errorKindForMemoryStatus(status: number, code?: string): MemoryHttpErrorKind {
  if (code === "sensitive_content") return "sensitive_content";
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 400:
    case 422:
      return "invalid";
    default:
      return status >= 500 ? "server_error" : "network_error";
  }
}

export function extractErrorPayload(raw: unknown): { message?: string; code?: string } {
  if (raw && typeof raw === "object") {
    const message = "message" in raw && typeof raw.message === "string" ? raw.message : undefined;
    const code = "error" in raw && typeof raw.error === "string" ? raw.error : undefined;
    return { message, code };
  }
  return {};
}
