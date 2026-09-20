import { create } from "zustand";
import type { ProviderReadinessSnapshot, ReadinessState } from "@nonclaw-ui/shared/types";

export type ReadinessPhase = "idle" | "checking" | "starting" | "ready" | "degraded_cpu" | "failed";

export interface ReadinessStoreState {
  phase: ReadinessPhase;
  snapshot: ProviderReadinessSnapshot | null;
  error: string | null;
  canInfer: boolean;
  startPolling(
    fetcher: (signal?: AbortSignal) => Promise<ProviderReadinessSnapshot>,
    contextKey?: string
  ): void;
  stopPolling(): void;
  retry(): void;
  reset(): void;
}

type TimeoutHandle = number;

let activeTimer: TimeoutHandle | null = null;
let activeController: AbortController | null = null;
let activeGeneration = 0;
let activeFetcher: ((signal?: AbortSignal) => Promise<ProviderReadinessSnapshot>) | null = null;
let activeContextKey: string | null = null;

function clearPollingHandle(): void {
  if (activeTimer !== null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeController !== null) {
    activeController.abort();
    activeController = null;
  }
}

export const useReadinessStore = create<ReadinessStoreState>((set, get) => {
  async function executePoll(generation: number): Promise<void> {
    if (generation !== activeGeneration || !activeFetcher) {
      return;
    }

    // Abort previous in-flight request if any
    if (activeController !== null) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;

    try {
      const snapshot = await activeFetcher(controller.signal);
      if (generation !== activeGeneration || controller.signal.aborted) {
        return;
      }

      const state: ReadinessState = snapshot.status;
      const canInfer = state === "ready" || state === "degraded_cpu";

      set({
        phase: state,
        snapshot,
        error: null,
        canInfer,
      });

      if (state === "starting") {
        if (activeTimer !== null) clearTimeout(activeTimer);
        activeTimer = setTimeout(() => {
          void executePoll(generation);
        }, 1000) as unknown as number;
      } else {
        clearPollingHandle();
      }
    } catch (err: unknown) {
      if (generation !== activeGeneration || controller.signal.aborted) {
        return;
      }
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      set({
        phase: "failed",
        error: message,
        canInfer: false,
      });

      clearPollingHandle();
    }
  }

  return {
    phase: "idle",
    snapshot: null,
    error: null,
    canInfer: false,

    startPolling: (fetcher, contextKey) => {
      activeFetcher = fetcher;
      const currentPhase = get().phase;

      // If already in terminal ready/degraded state for the same context, no need to restart
      if (
        contextKey !== undefined &&
        contextKey === activeContextKey &&
        (currentPhase === "ready" || currentPhase === "degraded_cpu")
      ) {
        return;
      }
      activeContextKey = contextKey ?? null;

      clearPollingHandle();
      const generation = ++activeGeneration;

      // Only set checking if we don't already have an active starting phase
      if (currentPhase !== "starting") {
        set({
          phase: "checking",
          error: null,
          canInfer: false,
        });
      }

      void executePoll(generation);
    },

    stopPolling: () => {
      clearPollingHandle();
      activeGeneration++;
      activeFetcher = null;
      activeContextKey = null;
      if (get().phase === "checking") {
        set({ phase: "idle", canInfer: false });
      }
    },

    retry: () => {
      if (!activeFetcher) return;
      clearPollingHandle();
      const generation = ++activeGeneration;

      set({
        phase: "checking",
        error: null,
        canInfer: false,
      });

      void executePoll(generation);
    },

    reset: () => {
      clearPollingHandle();
      activeGeneration++;
      activeFetcher = null;
      activeContextKey = null;

      set({
        phase: "idle",
        snapshot: null,
        error: null,
        canInfer: false,
      });
    },
  };
});
