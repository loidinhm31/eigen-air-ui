/**
 * React bindings for the image artifact store (no components here).
 *
 * `useImageHistorySync` owns the lifecycle for one active session: select it, fetch capabilities
 * (independent of chat provider readiness), list artifacts, subscribe to WS refetch hints and to
 * reconnect, and re-subscribe after an access/URL/connection invalidation (the store bumps
 * `invalidationEpoch`; services may have been re-created). Hints are refetch signals only.
 *
 * Contract for views (Slice C):
 * - The store is a singleton with ONE active session, so mount `useImageHistorySync` in ONE owner
 *   (the chat panel). Several same-session consumers are refcounted and safe; a second consumer
 *   with a different id would steal `activeSessionId`.
 * - Nothing is fetched while the connection is not `connected`. The first transition to
 *   `connected` (and every later return to it) lists the session; non-`known` capabilities are
 *   re-read first by `refreshSession`. A failed read keeps them unknown and the history
 *   unavailable (fail closed); a later explicit `refreshSession` in the same mounted lifecycle
 *   (no reconnect/remount) re-reads them and restores history from a fresh complete listing.
 * - Deactivation: when the last consumer of the active session unmounts (or switches away) the
 *   store deselects the session: pollers/timers stop, pending results are dropped, memory cleared.
 * - Never loop on `authorization_stale` from `loadImagePreview`: wait for a `listingStamps` or
 *   `status` change instead (the store refreshes at most once per second regardless).
 * - Render a loading state, not "no images", while `status === "idle"` (e.g. right after an
 *   invalidation or session switch, before the listing lands).
 */
import { useEffect, useMemo } from "react";
import type { ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import { getChatService } from "../adapters/factory/ServiceFactory.js";
import type { IChatService } from "../adapters/factory/interfaces/IChatService.js";
import { useConnectionStore } from "./connectionStore.js";
import { useImageArtifactStore, type ImageCapabilities } from "./image-artifact-store.js";
import {
  bindImageGroupsToMessages,
  groupImageArtifactsByRun,
  type ImageBindableMessage,
  type ImageGroupBinding,
} from "./image-run-groups.js";

function currentChatService(): IChatService | null {
  try {
    return getChatService();
  } catch {
    return null; // services not initialized yet: nothing to subscribe to
  }
}

/** Live `useImageHistorySync` consumers per session id (module-level: shared by all hook instances). */
const consumers = new Map<string, number>();

function retainSession(sessionId: string): void {
  consumers.set(sessionId, (consumers.get(sessionId) ?? 0) + 1);
  useImageArtifactStore.getState().setActiveSession(sessionId);
}

/**
 * Drops one consumer. The last release of a session deselects it, but only while that session is
 * still the active one: a stale cleanup of session A must never deactivate a newer session B.
 */
function releaseSession(sessionId: string): void {
  const remaining = (consumers.get(sessionId) ?? 1) - 1;
  if (remaining > 0) {
    consumers.set(sessionId, remaining);
    return;
  }
  consumers.delete(sessionId);
  const store = useImageArtifactStore.getState();
  if (store.activeSessionId === sessionId) store.setActiveSession(null);
}

export function useImageHistorySync(sessionId: string | null): void {
  const invalidationEpoch = useImageArtifactStore((s) => s.invalidationEpoch);
  const connected = useConnectionStore((s) => s.status === "connected");

  // Activation + refcounted deactivation. Declared first so it runs before the sync effect.
  useEffect(() => {
    if (sessionId === null) return undefined;
    retainSession(sessionId);
    return () => releaseSession(sessionId);
  }, [sessionId]);

  // Fetch + subscriptions. `connected` and `invalidationEpoch` are primitives that change only on
  // real transitions, so this cannot loop. Re-runs on return to `connected` retry capabilities.
  useEffect(() => {
    if (sessionId === null || !connected) return undefined;

    let active = true;
    const refetch = async (forceCapabilities: boolean): Promise<void> => {
      const state = useImageArtifactStore.getState();
      // Known capabilities are re-read only when forced (reconnect). Non-`known` ones are
      // re-read by `refreshSession` itself (exactly one read per attempt). A forced read that
      // loses readers already failed the listing closed in the store, so stop there.
      if (forceCapabilities && state.capabilities.status === "known") {
        await state.refreshCapabilities();
        if (useImageArtifactStore.getState().capabilities.status !== "known") return;
      }
      if (!active) return;
      await useImageArtifactStore.getState().refreshSession(sessionId);
    };

    void refetch(false);
    const chat = currentChatService();
    const offHint = chat?.onImageHint?.((signal) =>
      useImageArtifactStore.getState().handleHint(signal)
    );
    const offReconnect = chat?.onRunReconnect?.(() => void refetch(true));
    return () => {
      active = false;
      offHint?.();
      offReconnect?.();
    };
  }, [sessionId, invalidationEpoch, connected]);
}

export function useImageCapabilities(): ImageCapabilities {
  return useImageArtifactStore((s) => s.capabilities);
}

/** Artifact run groups bound (by exact run_id, assistant messages only) to the given messages. */
export function useSessionImageGroups(
  messages: readonly ImageBindableMessage[]
): ImageGroupBinding {
  const artifacts = useImageArtifactStore((s) => s.artifacts);
  return useMemo(
    () => bindImageGroupsToMessages(groupImageArtifactsByRun(artifacts), messages),
    [artifacts, messages]
  );
}

/** Tracked jobs (created/cancelled in this session view), oldest first. */
export function useTrackedImageJobs(): readonly ImageJobSnapshot[] {
  const jobs = useImageArtifactStore((s) => s.jobs);
  return useMemo(
    () =>
      Object.values(jobs).sort(
        (a, b) =>
          a.created_at_ms - b.created_at_ms ||
          (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0)
      ),
    [jobs]
  );
}
