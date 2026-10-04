import type {
  RunDebugExcerptDto,
  RunSnapshotDto,
} from "@eigen-air-ui/shared/types";
import { decodeRunSnapshot } from "@eigen-air-ui/shared/types";
import type { HttpRunAdapter } from "./HttpRunAdapter.js";
import {
  ALLOWED_EXCERPT_KINDS,
  extractModelFromSnapshot,
  mapUnavailableReason,
  MAX_DEBUG_PAGES,
  MAX_EXCERPTS_PER_PAGE,
  MAX_ROW_PLAINTEXT_BYTES,
  MAX_RUN_DEBUG_BYTES,
  projectExcerpts,
  UTF8_ENCODER,
  type ChatDebugLoaderResult,
  type ChatDebugReadyPayload,
} from "./chat-debug-projection.js";

export {
  MAX_DEBUG_PAGES,
  MAX_EXCERPTS_PER_PAGE,
  MAX_ROW_PLAINTEXT_BYTES,
  MAX_RUN_DEBUG_BYTES,
  UTF8_ENCODER,
  type ChatDebugLoaderResult,
  type ChatDebugReadyPayload,
};

export interface ChatDebugLoaderOptions {
  adapter: HttpRunAdapter;
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  now?: number;
}

/**
 * Scoped, bounded historical debug loader.
 * Fetches run snapshot and pages debug excerpts up to limits,
 * projecting them into a typed, memory-bounded result.
 */
export async function loadHistoricalDebug(
  options: ChatDebugLoaderOptions
): Promise<ChatDebugLoaderResult> {
  const { adapter, runId, sessionId, signal } = options;
  const now = options.now ?? Date.now();

  let cursor: string | undefined = undefined;
  let pageCount = 0;
  const visitedCursors = new Set<string>();
  const collectedExcerpts: RunDebugExcerptDto[] = [];
  const seenSeqs = new Set<number>();
  let aggregateBytes = 0;
  let isPartial = false;
  let initialProvider: string | undefined = undefined;
  let initialModel: string | undefined = undefined;

  while (pageCount < MAX_DEBUG_PAGES) {
    if (signal?.aborted) {
      throw new DOMException("The debug load request was aborted", "AbortError");
    }

    if (cursor !== undefined) {
      if (visitedCursors.has(cursor)) {
        isPartial = true;
        break;
      }
      visitedCursors.add(cursor);
    }

    let snapshot: RunSnapshotDto;
    try {
      const raw = await adapter.get(runId, {
        includeDebug: true,
        debugCursor: cursor,
        signal,
      });
      snapshot = decodeRunSnapshot(raw, runId);
    } catch (err: unknown) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        throw new DOMException("The debug load request was aborted", "AbortError");
      }

      let status: number | undefined;
      if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
        status = err.status;
      }

      if (status === 401 || status === 403) {
        return { status: "unavailable", runId, reason: "unauthorized" };
      }
      if (status === 404) {
        return { status: "unavailable", runId, reason: "not_found" };
      }

      if (collectedExcerpts.length > 0 && initialProvider) {
        isPartial = true;
        break;
      }

      const message = err instanceof Error ? err.message : "Run debug request failed";
      if (status === 503 || status === undefined) {
        return { status: "error", runId, message, retryable: true };
      }

      return { status: "unavailable", runId, reason: "invalid" };
    }

    if (snapshot.run.run_id !== runId || snapshot.run.session_id !== sessionId) {
      return { status: "unavailable", runId, reason: "invalid" };
    }

    if (!initialProvider) initialProvider = snapshot.run.provider_id;
    if (!initialModel) initialModel = extractModelFromSnapshot(snapshot);

    const redaction = snapshot.run.redaction;
    if (redaction.metadata_only || !redaction.debug_available) {
      if (collectedExcerpts.length > 0 && initialProvider) {
        isPartial = true;
        break;
      }
      return {
        status: "unavailable",
        runId,
        reason: mapUnavailableReason(redaction.unavailable_reason),
      };
    }

    const pageExcerpts = snapshot.debug_excerpts;
    if (!pageExcerpts || !Array.isArray(pageExcerpts) || pageExcerpts.length === 0) {
      if (collectedExcerpts.length === 0) {
        return { status: "unavailable", runId, reason: "no_debug_data" };
      }
      break;
    }

    if (pageExcerpts.length > MAX_EXCERPTS_PER_PAGE) {
      isPartial = true;
    }
    const safePageRows = pageExcerpts.slice(0, MAX_EXCERPTS_PER_PAGE);

    for (const excerpt of safePageRows) {
      if (!ALLOWED_EXCERPT_KINDS[excerpt.kind]) {
        continue;
      }

      const actualBytes = UTF8_ENCODER.encode(excerpt.plaintext).byteLength;
      const byteDiff = Math.abs(excerpt.plaintext_bytes - actualBytes);
      const maxAllowedDiscrepancy = Math.max(256, Math.ceil(actualBytes * 0.2));
      if (
        byteDiff > maxAllowedDiscrepancy ||
        actualBytes > MAX_ROW_PLAINTEXT_BYTES ||
        excerpt.plaintext_bytes > MAX_ROW_PLAINTEXT_BYTES
      ) {
        if (collectedExcerpts.length > 0 && initialProvider) {
          isPartial = true;
          break;
        }
        return { status: "unavailable", runId, reason: "invalid" };
      }

      if (seenSeqs.has(excerpt.excerpt_seq)) {
        continue;
      }

      if (aggregateBytes + actualBytes > MAX_RUN_DEBUG_BYTES) {
        isPartial = true;
        break;
      }

      seenSeqs.add(excerpt.excerpt_seq);
      aggregateBytes += actualBytes;
      collectedExcerpts.push(excerpt);
    }

    pageCount += 1;
    const nextCursor = snapshot.next_debug_cursor;
    if (!nextCursor || isPartial) {
      break;
    }
    cursor = nextCursor;
  }

  if (pageCount >= MAX_DEBUG_PAGES && cursor) {
    isPartial = true;
  }

  if (collectedExcerpts.length === 0) {
    return { status: "unavailable", runId, reason: "no_debug_data" };
  }

  return projectExcerpts(
    runId,
    initialProvider ?? "unknown",
    initialModel,
    collectedExcerpts,
    isPartial,
    now
  );
}
