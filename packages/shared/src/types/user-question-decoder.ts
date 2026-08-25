import type { ChatMessage, RunSnapshotDto } from "./api.js";
import type { ChatCompletedResponse, ChatWaitingForInputResponse } from "./user-question.js";
import type {
  UserQuestionAnswer,
  UserQuestionHttpErrorKind,
  UserQuestionKind,
  UserQuestionListResponse,
  UserQuestionMetadata,
  UserQuestionOption,
  UserQuestionRequest,
  UserQuestionSnapshot,
  UserQuestionState,
  UserQuestionUpdatedEvent,
} from "./user-question.js";
import { USER_QUESTION_SCHEMA } from "./user-question.js";
import type { ChatHistoryResponse, WsEvent, WsFrame, WsRes } from "./ws.js";
import { decodeTaskProgressSnapshot } from "./task-progress-decoder.js";

const MAX_WS_FRAME_BYTES = 64 * 1024;
const MAX_ID_BYTES = 512;
const MAX_PROMPT_BYTES = 2048;
const MAX_HELP_BYTES = 512;
const MAX_OPTION_LABEL_BYTES = 256;
const MAX_OPTION_COUNT = 8;
const MAX_QUESTION_LIST = 100;
const MAX_ERROR_TEXT_BYTES = 256;
const MAX_SHORT_TEXT_BYTES = 512;
const MAX_SHORT_TEXT_CHARS = 256;
const MAX_MULTILINE_BYTES = 4096;
const MAX_MULTILINE_CHARS = 2048;
const MAX_MULTILINE_LINES = 64;
const MAX_HISTORY_MESSAGES = 512;
const MAX_HISTORY_CONTENT_BYTES = 64 * 1024;
const MAX_HISTORY_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_RUN_ARRAY_ITEMS = 10_000;
const MAX_RUN_TEXT_BYTES = 512;
const MAX_RUN_ID_BYTES = 512;

export class UserQuestionDecodeError extends Error {
  constructor() {
    super("Invalid user question response");
    this.name = "UserQuestionDecodeError";
  }
}

function fail(): never {
  throw new UserQuestionDecodeError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && utf8Bytes(value) <= maxBytes;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isPlainText(value: unknown, maxBytes: number, allowNewline = true): value is string {
  if (!isNonEmptyString(value, maxBytes)) return false;
  return ![...value].some(
    (character) =>
      (character < " " && character !== "\n" && character !== "\t") ||
      (!allowNewline && character === "\n")
  ) && !hasProhibitedSemantics(value);
}

function hasProhibitedSemantics(value: string): boolean {
  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const prohibited = new Set([
    "password",
    "secret",
    "token",
    "credential",
    "file",
    "upload",
    "path",
    "approval",
    "allow",
    "deny",
  ]);
  if (words.some((word) => prohibited.has(word))) return true;
  return [
    ["api", "key"],
    ["private", "key"],
    ["seed", "phrase"],
  ].some((phrase) =>
    words.some((_, index) => phrase.every((word, offset) => words[index + offset] === word))
  );
}

function isBoundedText(
  value: unknown,
  maxBytes: number,
  maxChars: number,
  maxLines?: number
): value is string {
  if (!isPlainText(value, maxBytes)) return false;
  if ([...value].length > maxChars || (maxLines !== undefined && value.split("\n").length > maxLines)) {
    return false;
  }
  return !hasProhibitedSemantics(value);
}

function decodeOption(value: unknown): UserQuestionOption {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "label"])) fail();
  if (!isNonEmptyString(value.id, 64) || !/^[A-Za-z0-9_-]+$/.test(value.id)) fail();
  if (!isPlainText(value.label, MAX_OPTION_LABEL_BYTES, false)) fail();
  return { id: value.id, label: value.label };
}

export function decodeUserQuestionRequest(value: unknown): UserQuestionRequest {
  if (!isRecord(value) || typeof value.kind !== "string") fail();
  const baseKeys = ["kind", "prompt", "help"] as const;
  const allowedKeys =
    value.kind === "single_choice" ? ["kind", "prompt", "help", "options"] : baseKeys;
  if (!hasOnlyKeys(value, allowedKeys)) fail();
  if (!isPlainText(value.prompt, MAX_PROMPT_BYTES)) fail();
  if (value.help !== undefined && !isPlainText(value.help, MAX_HELP_BYTES)) fail();
  const help = value.help === undefined ? {} : { help: value.help };

  if (value.kind === "single_choice") {
    if (
      !Array.isArray(value.options) ||
      value.options.length < 2 ||
      value.options.length > MAX_OPTION_COUNT
    )
      fail();
    const options = value.options.map(decodeOption);
    if (new Set(options.map((option) => option.id)).size !== options.length) fail();
    return { kind: "single_choice", prompt: value.prompt, ...help, options };
  }
  if (value.kind === "short_text" || value.kind === "multiline") {
    return { kind: value.kind, prompt: value.prompt, ...help } as UserQuestionRequest;
  }
  // In particular, G4 approval-like kinds are not questions in this decoder.
  fail();
}

const QUESTION_STATES: readonly UserQuestionState[] = [
  "pending",
  "answered",
  "continuing",
  "resolved",
  "expired",
  "cancelled",
  "aborted",
  "failed",
];

function isQuestionState(value: unknown): value is UserQuestionState {
  return typeof value === "string" && QUESTION_STATES.includes(value as UserQuestionState);
}

function decodeMetadata(value: unknown, allowPrivateFields = false): UserQuestionMetadata {
  if (!isRecord(value)) fail();
  const required = [
    "schema_version",
    "question_id",
    "tenant_id",
    "user_id",
    "workspace_id",
    "session_id",
    "run_id",
    "turn_index",
    "state",
    "revision",
    "created_at_ms",
    "expires_at_ms",
    "terminal_at_ms",
    "redaction",
  ] as const;
  if (
    !hasOnlyKeys(value, allowPrivateFields ? [...required, "request", "mutation_token"] : required)
  )
    fail();
  if (
    value.schema_version !== USER_QUESTION_SCHEMA ||
    !isNonEmptyString(value.question_id, MAX_ID_BYTES) ||
    !isNonEmptyString(value.tenant_id, MAX_ID_BYTES) ||
    !isNonEmptyString(value.user_id, MAX_ID_BYTES) ||
    !isNonEmptyString(value.workspace_id, MAX_ID_BYTES) ||
    !isNonEmptyString(value.session_id, MAX_ID_BYTES) ||
    !isNonEmptyString(value.run_id, MAX_ID_BYTES) ||
    !isSafeInteger(value.turn_index) ||
    !isQuestionState(value.state) ||
    !isSafeInteger(value.revision) ||
    !isSafeInteger(value.created_at_ms) ||
    !isSafeInteger(value.expires_at_ms) ||
    !(value.terminal_at_ms === null || isSafeInteger(value.terminal_at_ms)) ||
    value.redaction !== "metadata_only"
  ) {
    fail();
  }
  return {
    schema_version: USER_QUESTION_SCHEMA,
    question_id: value.question_id,
    tenant_id: value.tenant_id,
    user_id: value.user_id,
    workspace_id: value.workspace_id,
    session_id: value.session_id,
    run_id: value.run_id,
    turn_index: value.turn_index,
    state: value.state,
    revision: value.revision,
    created_at_ms: value.created_at_ms,
    expires_at_ms: value.expires_at_ms,
    terminal_at_ms: value.terminal_at_ms,
    redaction: "metadata_only",
  };
}

export function decodeUserQuestionSnapshot(value: unknown): UserQuestionSnapshot {
  const metadata = decodeMetadata(value, true);
  if (!isRecord(value)) fail();
  const hasRequest = value.request !== undefined;
  const hasToken = value.mutation_token !== undefined;
  if (hasRequest && metadata.state !== "pending") fail();
  if (
    hasToken &&
    (metadata.state !== "pending" ||
      !isNonEmptyString(value.mutation_token, 32) ||
      !/^[a-f0-9]{32}$/.test(value.mutation_token))
  )
    fail();
  if (metadata.state === "pending" && hasRequest === false) {
    return metadata;
  }
  if (!hasRequest) return metadata;
  const request = decodeUserQuestionRequest(value.request);
  return {
    ...metadata,
    request,
    ...(hasToken ? { mutation_token: value.mutation_token as string } : {}),
  };
}

export function decodeUserQuestionAnswer(
  value: unknown,
  request?: UserQuestionRequest
): UserQuestionAnswer {
  if (!isRecord(value) || typeof value.kind !== "string") fail();
  if (value.kind === "single_choice") {
    if (
      !hasOnlyKeys(value, ["kind", "option_id"]) ||
      !isNonEmptyString(value.option_id, 64) ||
      !/^[A-Za-z0-9_-]+$/.test(value.option_id)
    ) {
      fail();
    }
    if (
      request?.kind === "single_choice" &&
      !request.options.some((option) => option.id === value.option_id)
    ) {
      fail();
    }
    return { kind: "single_choice", option_id: value.option_id };
  }

  if (value.kind === "short_text") {
    if (
      !hasOnlyKeys(value, ["kind", "text"]) ||
      !isBoundedText(value.text, MAX_SHORT_TEXT_BYTES, MAX_SHORT_TEXT_CHARS)
    ) {
      fail();
    }
    return { kind: "short_text", text: value.text };
  }

  if (value.kind === "multiline") {
    if (
      !hasOnlyKeys(value, ["kind", "text"]) ||
      !isBoundedText(
        value.text,
        MAX_MULTILINE_BYTES,
        MAX_MULTILINE_CHARS,
        MAX_MULTILINE_LINES
      )
    ) {
      fail();
    }
    return { kind: "multiline", text: value.text };
  }

  fail();
}

function decodeChatMessage(value: unknown): ChatMessage {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "role", "content", "debug"])) fail();
  if (
    value.id !== undefined && !isNonEmptyString(value.id, MAX_ID_BYTES) ||
    !["user", "assistant", "system"].includes(value.role as string) ||
    !isNonEmptyString(value.content, MAX_HISTORY_CONTENT_BYTES)
  ) {
    fail();
  }
  // G3 asks only for a history barrier. Debug payloads are optional and are
  // deliberately ignored here so they cannot become a question-state input.
  return {
    ...(value.id !== undefined ? { id: value.id as string } : {}),
    role: value.role as ChatMessage["role"],
    content: value.content as string,
  };
}

export function decodeChatHistoryResponse(value: unknown): ChatHistoryResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["messages"]) || !Array.isArray(value.messages)) fail();
  if (value.messages.length > MAX_HISTORY_MESSAGES) fail();
  let totalBytes = 0;
  const messages = value.messages.map((message) => {
    const decoded = decodeChatMessage(message);
    totalBytes += utf8Bytes(decoded.content);
    if (totalBytes > MAX_HISTORY_TOTAL_BYTES) fail();
    return decoded;
  });
  return { messages };
}

const RUN_LIFECYCLE_STATUSES = ["running", "completed", "failed", "skipped", "aborted"] as const;

function boundedRunString(value: unknown): value is string {
  return isNonEmptyString(value, MAX_RUN_ID_BYTES);
}

function nullableRunString(value: unknown): boolean {
  return value === undefined || value === null || boundedRunString(value);
}

function optionalSafeInteger(value: unknown): boolean {
  return value === undefined || value === null || isSafeInteger(value);
}

function decodeRunSummaryBarrier(value: unknown): void {
  if (!isRecord(value)) fail();
  if (
    !hasOnlyKeys(value, [
      "run_id",
      "trace_id",
      "request_id",
      "session_id",
      "parent_run_id",
      "root_run_id",
      "tenant_id",
      "user_id",
      "workspace_id",
      "agent_id",
      "provider_id",
      "channel",
      "lifecycle_status",
      "started_at_ms",
      "updated_at_ms",
      "completed_at_ms",
      "snapshot_seq",
      "correlation_state",
      "redaction",
      "usage",
    ])
  ) {
    fail();
  }
  const requiredStrings = [
    "run_id",
    "trace_id",
    "session_id",
    "root_run_id",
    "tenant_id",
    "user_id",
    "workspace_id",
    "agent_id",
    "provider_id",
    "channel",
    "correlation_state",
  ];
  if (requiredStrings.some((key) => !boundedRunString(value[key]))) fail();
  if (
    !RUN_LIFECYCLE_STATUSES.includes(value.lifecycle_status as (typeof RUN_LIFECYCLE_STATUSES)[number]) ||
    !isSafeInteger(value.started_at_ms) ||
    !isSafeInteger(value.updated_at_ms) ||
    !isSafeInteger(value.snapshot_seq) ||
    !isRecord(value.redaction) ||
    typeof value.redaction.metadata_only !== "boolean" ||
    typeof value.redaction.debug_requested !== "boolean" ||
    typeof value.redaction.debug_available !== "boolean"
  ) {
    fail();
  }
  if (
    !nullableRunString(value.request_id) ||
    !nullableRunString(value.parent_run_id) ||
    !optionalSafeInteger(value.completed_at_ms)
  ) {
    fail();
  }
  if (value.redaction.unavailable_reason !== undefined &&
      value.redaction.unavailable_reason !== null &&
      !["disabled", "unauthorized", "expired", "key_unavailable", "invalid"].includes(
        value.redaction.unavailable_reason as string
      )) {
    fail();
  }
  if (value.usage !== undefined && value.usage !== null) {
    if (!isRecord(value.usage) || !hasOnlyKeys(value.usage, [
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "origin",
    ])) fail();
    if (
      !optionalSafeInteger(value.usage.prompt_tokens) ||
      !optionalSafeInteger(value.usage.completion_tokens) ||
      !optionalSafeInteger(value.usage.total_tokens) ||
      !["reported", "estimated", "unknown"].includes(value.usage.origin as string)
    ) fail();
  }
}

function decodeRunArray(value: unknown, keys: readonly string[]): void {
  if (!Array.isArray(value) || value.length > MAX_RUN_ARRAY_ITEMS) fail();
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, keys)) fail();
  }
}

export function decodeRunSnapshot(value: unknown, expectedRunId?: string): RunSnapshotDto {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schema_version",
      "run",
      "events",
      "tool_calls",
      "memory_lineage",
      "debug_excerpts",
      "task_progress",
      "next_event_cursor",
      "next_tool_cursor",
      "next_lineage_cursor",
      "next_debug_cursor",
    ]) ||
    !isSafeInteger(value.schema_version)
  ) {
    fail();
  }
  decodeRunSummaryBarrier(value.run);
  if (expectedRunId !== undefined && (value.run as Record<string, unknown>).run_id !== expectedRunId) {
    fail();
  }
  decodeRunArray(value.events, [
    "event_id",
    "event_seq",
    "event_kind",
    "lifecycle_status",
    "occurred_at_ms",
    "safe_error_code",
    "policy_outcome",
  ]);
  decodeRunArray(value.tool_calls, [
    "tool_call_id",
    "ordinal",
    "tool_name",
    "status",
    "policy_outcome",
    "started_at_ms",
    "completed_at_ms",
    "safe_error_code",
  ]);
  decodeRunArray(value.memory_lineage, [
    "lineage_seq",
    "relation",
    "memory_kind",
    "memory_reference",
    "tenant_id",
    "user_id",
    "workspace_id",
    "agent_id",
    "source_episode_id",
    "provenance",
    "confidence",
    "occurred_at_ms",
  ]);
  for (const event of value.events as unknown[]) {
    if (!isRecord(event) || !boundedRunString(event.event_id) || !isSafeInteger(event.event_seq) ||
        !boundedRunString(event.event_kind) || !isSafeInteger(event.occurred_at_ms) ||
        !nullableRunString(event.safe_error_code) ||
        (event.lifecycle_status !== undefined && event.lifecycle_status !== null &&
          !RUN_LIFECYCLE_STATUSES.includes(event.lifecycle_status as (typeof RUN_LIFECYCLE_STATUSES)[number])) ||
        (event.policy_outcome !== undefined && event.policy_outcome !== null &&
          !["allowed", "denied", "not_applicable"].includes(event.policy_outcome as string))) {
      fail();
    }
  }
  for (const tool of value.tool_calls as unknown[]) {
    if (!isRecord(tool) || !boundedRunString(tool.tool_call_id) || !isSafeInteger(tool.ordinal) ||
        !boundedRunString(tool.tool_name) || !isSafeInteger(tool.started_at_ms) ||
        !optionalSafeInteger(tool.completed_at_ms) || !nullableRunString(tool.safe_error_code) ||
        !["requested", "running", "completed", "failed", "denied", "skipped"].includes(tool.status as string) ||
        (tool.policy_outcome !== undefined && tool.policy_outcome !== null &&
          !["allowed", "denied", "not_applicable"].includes(tool.policy_outcome as string))) {
      fail();
    }
  }
  for (const lineage of value.memory_lineage as unknown[]) {
    if (!isRecord(lineage) || !isSafeInteger(lineage.lineage_seq) ||
        !["considered", "used", "written"].includes(lineage.relation as string) ||
        !["working", "episode", "fact"].includes(lineage.memory_kind as string) ||
        !boundedRunString(lineage.memory_reference) || !boundedRunString(lineage.tenant_id) ||
        !boundedRunString(lineage.user_id) || !boundedRunString(lineage.workspace_id) ||
        !boundedRunString(lineage.agent_id) || !nullableRunString(lineage.source_episode_id) ||
        !nullableRunString(lineage.provenance) ||
        (lineage.confidence !== undefined && lineage.confidence !== null &&
          (typeof lineage.confidence !== "number" || !Number.isFinite(lineage.confidence))) ||
        !isSafeInteger(lineage.occurred_at_ms)) {
      fail();
    }
  }
  if (value.debug_excerpts !== undefined) {
    if (!Array.isArray(value.debug_excerpts) || value.debug_excerpts.length > 100) fail();
    for (const excerpt of value.debug_excerpts) {
      if (!isRecord(excerpt) || !hasOnlyKeys(excerpt, [
        "excerpt_seq",
        "kind",
        "plaintext",
        "created_at_ms",
        "expires_at_ms",
        "plaintext_bytes",
        "truncated",
        "redaction_count",
      ]) || !isSafeInteger(excerpt.excerpt_seq) || !boundedRunString(excerpt.kind) ||
          !isPlainText(excerpt.plaintext, 64 * 1024) || !isSafeInteger(excerpt.created_at_ms) ||
          !isSafeInteger(excerpt.expires_at_ms) || !isSafeInteger(excerpt.plaintext_bytes) ||
          typeof excerpt.truncated !== "boolean" || !isSafeInteger(excerpt.redaction_count)) {
        fail();
      }
    }
  }
  if (value.task_progress !== undefined && value.task_progress !== null) {
    try {
      decodeTaskProgressSnapshot(value.task_progress);
    } catch {
      fail();
    }
  }
  for (const key of [
    "next_event_cursor",
    "next_tool_cursor",
    "next_lineage_cursor",
    "next_debug_cursor",
  ] as const) {
    if (value[key] !== undefined && value[key] !== null && !isNonEmptyString(value[key], MAX_RUN_TEXT_BYTES)) {
      fail();
    }
  }
  return value as unknown as RunSnapshotDto;
}

export function decodeUserQuestionList(value: unknown): UserQuestionListResponse {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schema_version", "questions", "redaction"])) fail();
  if (
    value.schema_version !== USER_QUESTION_SCHEMA ||
    value.redaction !== "metadata_only" ||
    !Array.isArray(value.questions) ||
    value.questions.length > MAX_QUESTION_LIST
  )
    fail();
  const questions = value.questions.map((question) => decodeMetadata(question));
  return { schema_version: USER_QUESTION_SCHEMA, questions, redaction: "metadata_only" };
}

export function decodeUserQuestionMutation(value: unknown): {
  schema_version: typeof USER_QUESTION_SCHEMA;
  question: UserQuestionMetadata;
  status: "accepted";
} {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schema_version", "question", "status"])) fail();
  if (value.schema_version !== USER_QUESTION_SCHEMA || value.status !== "accepted") fail();
  return {
    schema_version: USER_QUESTION_SCHEMA,
    question: decodeMetadata(value.question),
    status: "accepted",
  };
}

export function decodeUserQuestionEvent(value: unknown): UserQuestionUpdatedEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "type",
      "version",
      "event",
      "payload",
      "session_id",
      "run_id",
      "request_id",
      "event_id",
      "event_seq",
      "occurred_at_ms",
      "trace_id",
      "parent_run_id",
      "root_run_id",
    ])
  )
    fail();
  if (
    value.type !== "event" ||
    value.version !== "v1" ||
    value.event !== "user_question.updated" ||
    !isRecord(value.payload)
  )
    fail();
  const payload = value.payload;
  if (
    !hasOnlyKeys(payload, [
      "question_id",
      "state",
      "revision",
      "kind",
      "redaction",
      "snapshot_seq",
      "snapshot_refetch_required",
    ]) ||
    !isNonEmptyString(payload.question_id, MAX_ID_BYTES) ||
    !isQuestionState(payload.state) ||
    !isSafeInteger(payload.revision)
  )
    fail();
  if (
    payload.kind !== undefined &&
    !["single_choice", "short_text", "multiline"].includes(payload.kind as string)
  )
    fail();
  if (payload.redaction !== undefined && payload.redaction !== "metadata_only") fail();
  if (payload.snapshot_seq !== undefined && !isSafeInteger(payload.snapshot_seq)) fail();
  if (payload.snapshot_refetch_required !== undefined && payload.snapshot_refetch_required !== true)
    fail();
  for (const key of [
    "session_id",
    "run_id",
    "request_id",
    "event_id",
    "trace_id",
    "parent_run_id",
    "root_run_id",
  ] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key], MAX_ID_BYTES)) fail();
  }
  for (const key of ["event_seq", "occurred_at_ms"] as const) {
    if (value[key] !== undefined && !isSafeInteger(value[key])) fail();
  }
  return value as unknown as UserQuestionUpdatedEvent;
}

function decodeResponse(value: unknown): WsRes {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "version", "id", "ok", "data", "error"]))
    fail();
  if (value.version !== undefined && value.version !== "v1") fail();
  if (value.type !== "res" || !isNonEmptyString(value.id, 256) || typeof value.ok !== "boolean")
    fail();
  if (value.error !== undefined) {
    if (
      !isRecord(value.error) ||
      !hasOnlyKeys(value.error, ["code", "message"]) ||
      !isNonEmptyString(value.error.code, 128) ||
      !isNonEmptyString(value.error.message, MAX_ERROR_TEXT_BYTES)
    )
      fail();
  }
  if (value.data !== undefined && JSON.stringify(value.data).length > MAX_WS_FRAME_BYTES) fail();
  return value as unknown as WsRes;
}

export function decodeWsFrame(value: unknown): WsFrame | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "res") return decodeResponse(value) as WsRes;
  if (value.type !== "event") return undefined;
  if (value.event === "user_question.updated") return decodeUserQuestionEvent(value);
  if (value.event === "task_progress.updated") return value as unknown as WsEvent;
  if (typeof value.event !== "string" || !isRecord(value.payload)) return undefined;
  return value as unknown as WsEvent;
}

export function decodeWsFrameJson(raw: unknown): WsFrame | undefined {
  if (typeof raw !== "string") return undefined;
  if (utf8Bytes(raw) > MAX_WS_FRAME_BYTES) return undefined;
  try {
    return decodeWsFrame(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function decodeChatSendResponse(
  value: unknown
): ChatWaitingForInputResponse | ChatCompletedResponse {
  if (!isRecord(value)) fail();
  if (value.status === "waiting_for_input") {
    if (
      !hasOnlyKeys(value, ["status", "run_id", "question_id", "snapshot_ref"]) ||
      !isNonEmptyString(value.run_id, MAX_ID_BYTES) ||
      !isNonEmptyString(value.question_id, MAX_ID_BYTES) ||
      !isNonEmptyString(value.snapshot_ref, MAX_ID_BYTES)
    )
      fail();
    return value as unknown as ChatWaitingForInputResponse;
  }
  if (
    !hasOnlyKeys(value, [
      "content",
      "tool_calls_made",
      "tool_limit_reached",
      "can_continue",
      "memory_updated",
      "memory_reason",
      "episode_id",
      "message_id",
      "fact_count",
      "debug",
    ]) ||
    !isNonEmptyString(value.content, 64 * 1024) ||
    !isSafeInteger(value.tool_calls_made) ||
    (value.tool_limit_reached !== undefined && typeof value.tool_limit_reached !== "boolean") ||
    (value.can_continue !== undefined && typeof value.can_continue !== "boolean") ||
    (value.memory_updated !== undefined && typeof value.memory_updated !== "boolean") ||
    (value.memory_reason !== undefined && !isNonEmptyString(value.memory_reason, 128)) ||
    !nullableRunString(value.episode_id) ||
    !nullableRunString(value.message_id) ||
    !optionalSafeInteger(value.fact_count)
  ) fail();
  if (value.debug !== undefined && value.debug !== null) {
    if (!isRecord(value.debug) || !hasOnlyKeys(value.debug, [
      "provider",
      "model",
      "active_skill",
      "system_prompt",
      "reasoning",
    ]) || !boundedRunString(value.debug.provider) || !boundedRunString(value.debug.model)) {
      fail();
    }
    if (value.debug.active_skill !== undefined && value.debug.active_skill !== null) {
      if (!isRecord(value.debug.active_skill) ||
          !hasOnlyKeys(value.debug.active_skill, ["name", "score"]) ||
          !boundedRunString(value.debug.active_skill.name) ||
          typeof value.debug.active_skill.score !== "number" ||
          !Number.isFinite(value.debug.active_skill.score)) fail();
    }
    if (!nullableRunString(value.debug.system_prompt)) fail();
    if (value.debug.reasoning !== undefined && value.debug.reasoning !== null) {
      if (!isRecord(value.debug.reasoning) ||
          !hasOnlyKeys(value.debug.reasoning, ["requested", "available", "text"]) ||
          typeof value.debug.reasoning.requested !== "boolean" ||
          typeof value.debug.reasoning.available !== "boolean" ||
          !nullableRunString(value.debug.reasoning.text)) fail();
    }
  }
  return value as unknown as ChatCompletedResponse;
}

export function errorKindForStatus(status: number): UserQuestionHttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  if (status === 0) return "aborted";
  return "unavailable";
}

export type { UserQuestionAnswer, UserQuestionKind, UserQuestionRequest, UserQuestionState };
