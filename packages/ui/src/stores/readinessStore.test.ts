import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadinessStore } from "./readinessStore.js";
import type { ProviderReadinessSnapshot } from "@nonclaw-ui/shared/types";

describe("readinessStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReadinessStore.getState().reset();
  });

  afterEach(() => {
    useReadinessStore.getState().reset();
    vi.useRealTimers();
  });

  it("starts in idle phase with canInfer false", () => {
    const state = useReadinessStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.canInfer).toBe(false);
    expect(state.snapshot).toBeNull();
  });

  it("polls while starting and schedules next poll", async () => {
    const startingSnapshot: ProviderReadinessSnapshot = {
      status: "starting",
      retryable: true,
      details: {
        stages: [
          { name: "config_validation", status: "completed", elapsed_ms: 5 },
          { name: "model_load", status: "running" },
        ],
      },
    };

    const fetcher = vi.fn().mockResolvedValue(startingSnapshot);
    useReadinessStore.getState().startPolling(fetcher);

    expect(useReadinessStore.getState().phase).toBe("checking");
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(useReadinessStore.getState().phase).toBe("starting");
    expect(useReadinessStore.getState().canInfer).toBe(false);
    expect(useReadinessStore.getState().snapshot?.status).toBe("starting");

    // Advance 1s for the next poll
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("transitions to ready and stops polling when provider is ready", async () => {
    const readySnapshot: ProviderReadinessSnapshot = {
      status: "ready",
      retryable: false,
      details: {
        stages: [
          { name: "config_validation", status: "completed" },
          { name: "model_load", status: "completed" },
        ],
      },
    };

    const fetcher = vi.fn().mockResolvedValue(readySnapshot);
    useReadinessStore.getState().startPolling(fetcher);

    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(useReadinessStore.getState().phase).toBe("ready");
    expect(useReadinessStore.getState().canInfer).toBe(true);

    // Advance 2s; no further poll should happen
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("transitions to failed when fetcher errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network failed"));
    useReadinessStore.getState().startPolling(fetcher);

    await Promise.resolve();

    expect(useReadinessStore.getState().phase).toBe("failed");
    expect(useReadinessStore.getState().error).toBe("Network failed");
    expect(useReadinessStore.getState().canInfer).toBe(false);

    // Advance; stopped
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops polling on stopPolling()", async () => {
    const startingSnapshot: ProviderReadinessSnapshot = {
      status: "starting",
      retryable: true,
      details: { stages: [] },
    };

    const fetcher = vi.fn().mockResolvedValue(startingSnapshot);
    useReadinessStore.getState().startPolling(fetcher);

    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    useReadinessStore.getState().stopPolling();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
