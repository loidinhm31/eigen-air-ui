import { create } from "zustand";
import type { HistoricalDebugState, RunSnapshotDto } from "@eigen-air-ui/shared/types";
import { getRunService, getServiceAccessContext, registerAccessInvalidationListener } from "../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "./connectionStore.js";
import { useDebugSettingsStore } from "./debugSettingsStore.js";
import { loadHistoricalDebug } from "../adapters/http/chat-debug-loader.js";
import { toHistoricalReadyState } from "../adapters/http/chat-debug-projection.js";
import { ChatDebugCache } from "./chat-debug-cache.js";
import { ChatDebugActiveLoadsManager, MAX_CONCURRENT_LOADS } from "./chat-debug-active-loads.js";
import { seedSnapshotIntoCache } from "./chat-debug-seeding.js";
import { ChatDebugExpiryTimer } from "./chat-debug-timer.js";

export { MAX_CONCURRENT_LOADS };

export interface ChatDebugStore {
  states: Record<string, HistoricalDebugState>;
  accessEpoch: number;
  earliestExpiryMs?: number;
  getState(sessionId: string, runId: string): HistoricalDebugState;
  requestDebug(sessionId: string, runId: string, consumerId: string): Promise<HistoricalDebugState>;
  cancelInterest(sessionId: string, runId: string, consumerId: string): void;
  invalidateAccess(nextEpoch?: number): void;
  clearDebugCache(): void;
  evictRun(runId: string): void;
  evictSession(sessionId: string): void;
  expireStale(now?: number): void;
  seedFromSnapshot(snapshot: RunSnapshotDto, sessionId: string): void;
}

const memoryCache = new ChatDebugCache();
const loadsManager = new ChatDebugActiveLoadsManager();
const expiryTimer = new ChatDebugExpiryTimer();

export const useChatDebugStore = create<ChatDebugStore>((set, get) => ({
  states: {},
  accessEpoch: 0,
  earliestExpiryMs: undefined,

  getState: (sessionId, runId) => {
    const key = `${sessionId}::${runId}`;
    const existing = get().states[key];
    if (existing && existing.status === "ready" && Date.now() >= existing.expiresAtMs) {
      get().expireStale();
      return { status: "unavailable", runId, reason: "expired" };
    }
    return existing ?? { status: "idle" };
  },

  requestDebug: async (sessionId, runId, consumerId) => {
    const key = `${sessionId}::${runId}`;
    const daemonUrl = useConnectionStore.getState().url ?? "";
    const accessContext = getServiceAccessContext();
    const currentEpoch = get().accessEpoch;

    if (!accessContext.capabilities?.has("run:read:debug")) {
      memoryCache.evictRun(runId);
      const denied: HistoricalDebugState = { status: "unavailable", runId, reason: "unauthorized" };
      set((s) => ({ states: { ...s.states, [key]: denied } }));
      return denied;
    }

    const cached = memoryCache.get(daemonUrl, currentEpoch, sessionId, runId);
    if (cached) {
      const ready = toHistoricalReadyState(cached);
      set((s) => ({ states: { ...s.states, [key]: ready }, earliestExpiryMs: memoryCache.getEarliestExpiry() }));
      return ready;
    }

    const existingLoad = loadsManager.get(key);
    if (existingLoad && existingLoad.accessEpoch === currentEpoch) {
      existingLoad.consumerIds.add(consumerId);
      await existingLoad.promise;
      return get().getState(sessionId, runId);
    }

    if (loadsManager.isAtCapacity()) {
      loadsManager.enqueue({ sessionId, runId, consumerId });
      set((s) => ({ states: { ...s.states, [key]: { status: "loading" } } }));
      return { status: "loading" };
    }

    const abortController = new AbortController();
    set((s) => ({ states: { ...s.states, [key]: { status: "loading" } } }));

    const loadPromise = (async () => {
      try {
        return await loadHistoricalDebug({
          adapter: getRunService(),
          runId,
          sessionId,
          signal: abortController.signal,
          now: Date.now(),
        });
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          return { status: "unavailable", runId, reason: "invalid" } as const;
        }
        const message = err instanceof Error ? err.message : "Debug load error";
        return { status: "error", runId, message, retryable: true } as const;
      }
    })();

    loadsManager.registerActive(key, abortController, loadPromise, consumerId, currentEpoch);
    const result = await loadPromise;
    loadsManager.removeActive(key);

    if (get().accessEpoch !== currentEpoch || abortController.signal.aborted) {
      return get().getState(sessionId, runId);
    }

    let nextState: HistoricalDebugState;
    if (result.status === "ready") {
      if (!result.isPartial) memoryCache.put(daemonUrl, currentEpoch, sessionId, runId, result);
      nextState = toHistoricalReadyState(result);
    } else {
      if (result.status === "unavailable" && (result.reason === "unauthorized" || result.reason === "not_found")) {
        memoryCache.evictRun(runId);
      }
      nextState = result;
    }

    const earliest = memoryCache.getEarliestExpiry();
    set((s) => ({ states: { ...s.states, [key]: nextState }, earliestExpiryMs: earliest }));
    expiryTimer.schedule(earliest, () => get().expireStale());

    if (loadsManager.hasQueued() && !loadsManager.isAtCapacity()) {
      const next = loadsManager.dequeue();
      if (next) void get().requestDebug(next.sessionId, next.runId, next.consumerId);
    }
    return nextState;
  },

  cancelInterest: (sessionId, runId, consumerId) => {
    const key = `${sessionId}::${runId}`;
    const removedQueued = loadsManager.removeQueued(sessionId, runId, consumerId);
    const releasedActive = loadsManager.releaseInterest(key, consumerId);
    if (removedQueued || releasedActive) {
      set((s) => {
        if (s.states[key]?.status === "loading") {
          const next = { ...s.states };
          delete next[key];
          return { states: next };
        }
        return s;
      });
    }
  },

  invalidateAccess: (nextEpoch) => {
    loadsManager.abortAll();
    memoryCache.clear();
    expiryTimer.clear();
    set({ states: {}, accessEpoch: nextEpoch ?? get().accessEpoch + 1, earliestExpiryMs: undefined });
  },

  clearDebugCache: () => {
    loadsManager.abortAll();
    memoryCache.clear();
    expiryTimer.clear();
    set({ states: {}, earliestExpiryMs: undefined });
  },

  evictRun: (runId) => {
    memoryCache.evictRun(runId);
    set((s) => {
      const next = Object.fromEntries(Object.entries(s.states).filter(([, st]) => !("runId" in st) || st.runId !== runId));
      return { states: next, earliestExpiryMs: memoryCache.getEarliestExpiry() };
    });
  },

  evictSession: (sessionId) => {
    memoryCache.evictSession(sessionId);
    set((s) => {
      const next = Object.fromEntries(Object.entries(s.states).filter(([key]) => !key.startsWith(`${sessionId}::`)));
      return { states: next, earliestExpiryMs: memoryCache.getEarliestExpiry() };
    });
  },

  expireStale: (now = Date.now()) => {
    memoryCache.evictExpired(now);
    const earliest = memoryCache.getEarliestExpiry();
    set((s) => {
      const next = { ...s.states };
      for (const [key, state] of Object.entries(next)) {
        if (state.status === "ready" && now >= state.expiresAtMs) {
          next[key] = { status: "unavailable", runId: state.runId, reason: "expired" };
        }
      }
      return { states: next, earliestExpiryMs: earliest };
    });
    expiryTimer.schedule(earliest, () => get().expireStale());
  },

  seedFromSnapshot: (snapshot, sessionId) => {
    const daemonUrl = useConnectionStore.getState().url ?? "";
    const seeded = seedSnapshotIntoCache(snapshot, sessionId, daemonUrl, get().accessEpoch, memoryCache);
    if (seeded) {
      set((s) => ({ states: { ...s.states, [seeded.key]: seeded.state }, earliestExpiryMs: memoryCache.getEarliestExpiry() }));
    }
  },
}));

registerAccessInvalidationListener((rev) => useChatDebugStore.getState().invalidateAccess(rev));
useConnectionStore.subscribe((s, p) => { if (s.url !== p.url) useChatDebugStore.getState().invalidateAccess(); });
useDebugSettingsStore.subscribe((s) => {
  if (!s.showPromptDebug && !s.showReasoningDebug) useChatDebugStore.getState().clearDebugCache();
});
