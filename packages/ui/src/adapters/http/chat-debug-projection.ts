import type {
  HistoricalDebugState,
  HistoricalDebugUnavailableReason,
  RunDebugExcerptDto,
  RunSnapshotDto,
} from "@eigen-air-ui/shared/types";

export const MAX_DEBUG_PAGES = 16;
export const MAX_EXCERPTS_PER_PAGE = 500;
export const MAX_ROW_PLAINTEXT_BYTES = 16 * 1024; // 16 KiB per row
export const MAX_RUN_DEBUG_BYTES = 64 * 1024; // 64 KiB aggregate per run

export const UTF8_ENCODER = new TextEncoder();

export const ALLOWED_EXCERPT_KINDS: Record<string, true> = {
  system_prompt: true,
  provider_reasoning: true,
};

export interface ChatDebugReadyPayload {
  status: "ready";
  runId: string;
  provider: string;
  model?: string;
  systemPrompt?: string;
  reasoning?: {
    available: boolean;
    text: string;
    truncated: boolean;
  };
  expiresAtMs: number;
  isPartial: boolean;
  plaintextBytes: number;
}

export type ChatDebugLoaderResult =
  | ChatDebugReadyPayload
  | {
      status: "unavailable";
      runId: string;
      reason: HistoricalDebugUnavailableReason;
    }
  | {
      status: "error";
      runId: string;
      message: string;
      retryable: boolean;
    };

export function extractModelFromSnapshot(snapshot: RunSnapshotDto): string | undefined {
  if (!snapshot.events || !Array.isArray(snapshot.events)) return undefined;
  for (const event of snapshot.events) {
    const model = event.request_provenance?.model;
    if (typeof model === "string" && model.trim().length > 0) {
      return model.trim();
    }
  }
  return undefined;
}

export function mapUnavailableReason(rawReason: unknown): HistoricalDebugUnavailableReason {
  if (
    rawReason === "disabled" ||
    rawReason === "unauthorized" ||
    rawReason === "expired" ||
    rawReason === "key_unavailable" ||
    rawReason === "invalid"
  ) {
    return rawReason;
  }
  return "no_debug_data";
}

export function projectExcerpts(
  runId: string,
  provider: string,
  model: string | undefined,
  excerpts: RunDebugExcerptDto[],
  isPartial: boolean,
  now: number
): ChatDebugLoaderResult {
  const nonExpired = excerpts.filter((e) => e.expires_at_ms > now);
  if (nonExpired.length === 0) {
    return {
      status: "unavailable",
      runId,
      reason: excerpts.length > 0 ? "expired" : "no_debug_data",
    };
  }

  // Sort strictly by excerpt_seq ascending
  nonExpired.sort((a, b) => a.excerpt_seq - b.excerpt_seq);

  const promptExcerpts = nonExpired.filter((e) => e.kind === "system_prompt");
  const reasoningExcerpts = nonExpired.filter((e) => e.kind === "provider_reasoning");

  let totalBytes = 0;
  for (const e of nonExpired) {
    totalBytes += e.plaintext_bytes;
  }

  const systemPrompt =
    promptExcerpts.length > 0
      ? promptExcerpts.map((e) => e.plaintext).join("\n\n---\n\n")
      : undefined;

  const hasReasoning = reasoningExcerpts.length > 0;
  const reasoningText = reasoningExcerpts.map((e) => e.plaintext).join("\n\n");
  const reasoningTruncated =
    reasoningExcerpts.some((e) => e.truncated) || isPartial;

  const expiresAtMs = Math.min(...nonExpired.map((e) => e.expires_at_ms));

  return {
    status: "ready",
    runId,
    provider,
    ...(model ? { model } : {}),
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    reasoning: {
      available: hasReasoning,
      text: reasoningText,
      truncated: reasoningTruncated,
    },
    expiresAtMs,
    isPartial,
    plaintextBytes: totalBytes,
  };
}

export function toHistoricalReadyState(payload: ChatDebugReadyPayload): HistoricalDebugState {
  return {
    status: "ready",
    runId: payload.runId,
    provider: payload.provider,
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.systemPrompt !== undefined ? { systemPrompt: payload.systemPrompt } : {}),
    reasoning: payload.reasoning,
    expiresAtMs: payload.expiresAtMs,
    isPartial: payload.isPartial,
  };
}
