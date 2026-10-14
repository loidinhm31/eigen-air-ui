export type SkillHttpErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_required"
  | "precondition_failed"
  | "payload_too_large"
  | "unsupported_media_type"
  | "invalid"
  | "server_error"
  | "network_error"
  | "aborted";

export class SkillHttpError extends Error {
  readonly kind: SkillHttpErrorKind;
  readonly status: number;
  readonly code?: string;

  constructor(status: number, kind: SkillHttpErrorKind, message?: string, code?: string) {
    super(message ?? defaultMessageForKind(kind));
    this.name = "SkillHttpError";
    this.status = status;
    this.kind = kind;
    this.code = code;
  }
}

export function defaultMessageForKind(kind: SkillHttpErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "Authentication required";
    case "forbidden":
      return "Owner access required for skill management";
    case "not_found":
      return "Skill package not found";
    case "conflict":
      return "Skill already exists or import busy";
    case "precondition_required":
      return "Precondition required for skill mutation";
    case "precondition_failed":
      return "Skill revision or installation identity mismatch";
    case "payload_too_large":
      return "Package size exceeds storage or upload limit";
    case "unsupported_media_type":
      return "Unsupported package format or resource type";
    case "invalid":
      return "Invalid skill request or archive structure";
    case "server_error":
      return "Skill service unavailable";
    case "network_error":
      return "Network communication failed";
    case "aborted":
      return "Skill request was cancelled";
  }
}

export function errorKindForSkillStatus(status: number, code?: string): SkillHttpErrorKind {
  if (code === "skill_id_collision" || code === "skill_import_busy") return "conflict";
  if (code === "stale_revision") return "precondition_failed";
  if (code === "payload_too_large" || code === "quota_exceeded") return "payload_too_large";

  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 412:
      return "precondition_failed";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 428:
      return "precondition_required";
    case 400:
    case 422:
      return "invalid";
    default:
      return status >= 500 ? "server_error" : "network_error";
  }
}

export function extractSkillErrorPayload(raw: unknown): { message?: string; code?: string } {
  if (raw && typeof raw === "object") {
    const code = "error" in raw && typeof raw.error === "string" ? raw.error : undefined;
    let message = "message" in raw && typeof raw.message === "string" ? raw.message : undefined;
    if (!message && code) {
      switch (code) {
        case "stale_revision":
          message = "Skill revision or install identity mismatch. Please refresh and review.";
          break;
        case "skill_id_collision":
          message = "A skill with this ID already exists.";
          break;
        case "skill_import_busy":
          message = "Another skill import is currently in progress. Please retry in a moment.";
          break;
        case "quota_exceeded":
        case "payload_too_large":
          message = "Package size exceeds storage or upload limit.";
          break;
        case "unsupported_media_type":
          message = "Unsupported package format or archive structure.";
          break;
        case "owner_credential_required":
        case "unauthorized":
          message = "Owner authorization required for this action.";
          break;
        default:
          message = undefined;
          break;
      }
    }
    return { message, code };
  }
  return {};
}
