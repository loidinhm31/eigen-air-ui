/**
 * Grouping/binding of durable image artifacts (pure) and listing -> preview-cache reconciliation
 * (`reconcileImageListing`, the only function here that touches a cache).
 *
 * Binding rule (frozen decision 2): an artifact group binds to a chat message ONLY by exact
 * `run_id` equality with an `assistant` message (the LAST such message when several share the
 * run id). Never by message/provider ids, text, or markers. Groups with no matching message
 * (aborted turn, direct_template run, incomplete history) stay `unbound`; no message is fabricated.
 */
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import type { ArtifactBlobCache } from "./artifact-blob-cache.js";

export interface ImageRunGroup {
  runId: string;
  sessionId: string;
  /** Grouped by job (jobs ordered by earliest created_at_ms, then job_id), ordinal order inside a job. */
  items: ImageArtifactRef[];
  jobIds: string[];
  /** Unique tool_call_ids of agent_tool jobs, in item order. Only groups items within the run. */
  toolCallIds: string[];
}

/** Structural subset of `ChatMessage`; ids/text are deliberately not part of the binding input. */
export interface ImageBindableMessage {
  id?: string;
  role: string;
  run_id?: string;
}

export interface ImageGroupBinding {
  /** Message index -> groups bound to that assistant message (group order preserved). */
  bound: Map<number, ImageRunGroup[]>;
  unbound: ImageRunGroup[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Groups by (session, run); groups ordered by earliest `created_at_ms` (ties: session, run id). Duplicate artifact ids: first wins. */
export function groupImageArtifactsByRun(artifacts: readonly ImageArtifactRef[]): ImageRunGroup[] {
  const seen = new Set<string>();
  const byRun = new Map<string, ImageArtifactRef[]>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.artifact_id)) continue;
    seen.add(artifact.artifact_id);
    const key = `${artifact.session_id}\u0000${artifact.run_id}`;
    const list = byRun.get(key);
    if (list) list.push(artifact);
    else byRun.set(key, [artifact]);
  }

  const entries = [...byRun.values()].map((list) => {
    const earliestByJob = new Map<string, number>();
    for (const a of list) {
      earliestByJob.set(
        a.job_id,
        Math.min(earliestByJob.get(a.job_id) ?? Infinity, a.created_at_ms)
      );
    }
    const items = [...list].sort(
      (a, b) =>
        earliestByJob.get(a.job_id)! - earliestByJob.get(b.job_id)! ||
        compare(a.job_id, b.job_id) ||
        a.ordinal - b.ordinal ||
        compare(a.artifact_id, b.artifact_id)
    );
    const group: ImageRunGroup = {
      runId: items[0]!.run_id,
      sessionId: items[0]!.session_id,
      items,
      jobIds: [...new Set(items.map((a) => a.job_id))],
      toolCallIds: [...new Set(items.flatMap((a) => (a.tool_call_id ? [a.tool_call_id] : [])))],
    };
    return { group, earliest: Math.min(...earliestByJob.values()) };
  });

  entries.sort(
    (a, b) =>
      a.earliest - b.earliest ||
      compare(a.group.sessionId, b.group.sessionId) ||
      compare(a.group.runId, b.group.runId)
  );
  return entries.map((e) => e.group);
}

export function bindImageGroupsToMessages(
  groups: readonly ImageRunGroup[],
  messages: readonly ImageBindableMessage[]
): ImageGroupBinding {
  const lastAssistantByRun = new Map<string, number>();
  messages.forEach((message, index) => {
    if (
      message.role === "assistant" &&
      typeof message.run_id === "string" &&
      message.run_id !== ""
    ) {
      lastAssistantByRun.set(message.run_id, index);
    }
  });

  const bound = new Map<number, ImageRunGroup[]>();
  const unbound: ImageRunGroup[] = [];
  for (const group of groups) {
    const index = lastAssistantByRun.get(group.runId);
    if (index === undefined) {
      unbound.push(group);
      continue;
    }
    const list = bound.get(index);
    if (list) list.push(group);
    else bound.set(index, [group]);
  }
  return { bound, unbound };
}

/** Cache surface `reconcileImageListing` needs (structural subset of `ArtifactBlobCache`). */
type ListingCache = Pick<ArtifactBlobCache, "renew" | "invalidateScope">;

const byCreatedThenId = (a: ImageArtifactRef, b: ImageArtifactRef): number =>
  a.created_at_ms - b.created_at_ms || compare(a.artifact_id, b.artifact_id);

/**
 * Installs a COMPLETE listing into the preview cache: returns the sorted artifacts and one
 * `stamp` per run, invalidates cached bytes of artifacts that vanished or are no longer committed
 * (whole scope when the run is gone), then renews leases of committed artifacts anchored at
 * `stamp` (the pre-request cache clock). `previous` = the artifacts being replaced.
 */
export function reconcileImageListing(
  cache: ListingCache,
  sessionId: string,
  previous: readonly ImageArtifactRef[],
  items: readonly ImageArtifactRef[],
  stamp: number
): { artifacts: ImageArtifactRef[]; stamps: Record<string, number> } {
  const artifacts = [...items].sort(byCreatedThenId);
  const committedByRun = new Map<string, string[]>();
  const stamps: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const artifact of artifacts) {
    stamps[artifact.run_id] = stamp;
    const ids = committedByRun.get(artifact.run_id) ?? [];
    if (artifact.state === "committed") ids.push(artifact.artifact_id);
    committedByRun.set(artifact.run_id, ids);
  }
  const stillCommitted = new Set([...committedByRun.values()].flat());
  const lost = new Map<string, string[]>();
  for (const old of previous) {
    if (stillCommitted.has(old.artifact_id)) continue;
    const ids = lost.get(old.run_id) ?? [];
    ids.push(old.artifact_id);
    lost.set(old.run_id, ids);
  }
  for (const [runId, ids] of lost) {
    cache.invalidateScope(
      committedByRun.has(runId) ? { sessionId, runId, artifactIds: ids } : { sessionId, runId }
    );
  }
  for (const [runId, ids] of committedByRun) {
    if (ids.length > 0) cache.renew(sessionId, runId, ids, stamp);
  }
  return { artifacts, stamps };
}
