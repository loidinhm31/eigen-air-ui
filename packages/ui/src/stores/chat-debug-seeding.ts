import type {
  HistoricalDebugState,
  RunSnapshotDto,
} from "@eigen-air-ui/shared/types";
import {
  projectExcerpts,
  extractModelFromSnapshot,
  toHistoricalReadyState,
} from "../adapters/http/chat-debug-projection.js";
import type { ChatDebugCache } from "./chat-debug-cache.js";

export function seedSnapshotIntoCache(
  snapshot: RunSnapshotDto,
  sessionId: string,
  daemonUrl: string,
  accessEpoch: number,
  memoryCache: ChatDebugCache
): { key: string; state: HistoricalDebugState } | undefined {
  const runId = snapshot.run.run_id;
  if (snapshot.run.session_id !== sessionId) return undefined;
  if (snapshot.run.redaction.metadata_only || !snapshot.run.redaction.debug_available) return undefined;
  if (!snapshot.debug_excerpts || snapshot.debug_excerpts.length === 0) return undefined;

  const projected = projectExcerpts(
    runId,
    snapshot.run.provider_id,
    extractModelFromSnapshot(snapshot),
    snapshot.debug_excerpts,
    Boolean(snapshot.next_debug_cursor),
    Date.now()
  );

  if (projected.status === "ready" && !projected.isPartial) {
    memoryCache.put(daemonUrl, accessEpoch, sessionId, runId, projected);
    const key = `${sessionId}::${runId}`;
    return { key, state: toHistoricalReadyState(projected) };
  }
  return undefined;
}
