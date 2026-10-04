import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto } from "@eigen-air-ui/shared/types";
import { HttpRunAdapter } from "../adapters/http/HttpRunAdapter.js";
import { setRunService, setServiceAccessContext } from "../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "./connectionStore.js";
import { useDebugSettingsStore } from "./debugSettingsStore.js";
import { useChatDebugStore } from "./chat-debug-store.js";

function makeTestSnapshot(runId: string, sessionId: string, text = "Test prompt"): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: runId,
      trace_id: `trace-${runId}`,
      session_id: sessionId,
      root_run_id: runId,
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "ws-1",
      agent_id: "agent-1",
      provider_id: "mock-prov",
      channel: "ws",
      lifecycle_status: "completed",
      started_at_ms: 1000,
      updated_at_ms: 2000,
      completed_at_ms: 2000,
      snapshot_seq: 1,
      correlation_state: "correlated",
      redaction: {
        metadata_only: false,
        debug_requested: true,
        debug_available: true,
        unavailable_reason: null,
      },
    },
    events: [],
    tool_calls: [],
    memory_lineage: [],
    debug_excerpts: [
      {
        excerpt_seq: 1,
        kind: "system_prompt",
        plaintext: text,
        plaintext_bytes: text.length,
        created_at_ms: 1000,
        expires_at_ms: Date.now() + 60000,
        truncated: false,
        redaction_count: 0,
      },
    ],
    next_debug_cursor: null,
  };
}

describe("ChatDebugStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatDebugStore.getState().clearDebugCache();
    useConnectionStore.getState().setUrl("http://127.0.0.1:18790");
    setServiceAccessContext({
      authToken: "test-token",
      capabilities: new Set(["run:read:debug", "run:export", "run:delete"]),
    });
    useDebugSettingsStore.setState({ showPromptDebug: true, showReasoningDebug: true });
  });

  it("V07: loads on first request and returns from memory cache on repeat with 0 extra REST calls", async () => {
    const getFn = vi.fn().mockResolvedValue(makeTestSnapshot("run-1", "sess-1"));
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    const first = await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-1");
    expect(first.status).toBe("ready");
    expect(getFn).toHaveBeenCalledTimes(1);

    const second = await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-2");
    expect(second.status).toBe("ready");
    expect(getFn).toHaveBeenCalledTimes(1);
  });

  it("denies access immediately when run:read:debug capability is missing", async () => {
    setServiceAccessContext({ capabilities: new Set() });
    const getFn = vi.fn();
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    const result = await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-1");
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("unauthorized");
    expect(getFn).not.toHaveBeenCalled();
  });
  it("V05: deduplicates concurrent requests for the same run across multiple consumers", async () => {
    let resolveGet!: (value: RunSnapshotDto) => void;
    const deferred = new Promise<RunSnapshotDto>((resolve) => {
      resolveGet = resolve;
    });
    const getFn = vi.fn().mockReturnValue(deferred);
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    const promise1 = useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-1");
    const promise2 = useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-2");

    expect(getFn).toHaveBeenCalledTimes(1);
    resolveGet(makeTestSnapshot("run-1", "sess-1"));
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1.status).toBe("ready");
    expect(res2.status).toBe("ready");
    expect(getFn).toHaveBeenCalledTimes(1);
  });

  it("V06: refcounts consumers so closing one does not abort if another consumer is still interested", async () => {
    let capturedSignal: AbortSignal | undefined;
    const pendingPromise = new Promise<RunSnapshotDto>(() => {});
    const getFn = vi.fn().mockImplementation((_runId: string, opts?: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      return pendingPromise;
    });
    setRunService({ get: getFn } as unknown as HttpRunAdapter);
    void useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-1");
    void useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-2");

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    useChatDebugStore.getState().cancelInterest("sess-1", "run-1", "consumer-1");
    expect(capturedSignal?.aborted).toBe(false);

    useChatDebugStore.getState().cancelInterest("sess-1", "run-1", "consumer-2");
    expect(capturedSignal?.aborted).toBe(true);
  });
  it("V06: late abort on cancelInterest leaves state idle and does not overwrite with invalid", async () => {
    let rejectPromise!: (err: Error) => void;
    const pendingPromise = new Promise<RunSnapshotDto>((_, reject) => {
      rejectPromise = reject;
    });
    const getFn = vi.fn().mockImplementation((_runId: string) => pendingPromise);
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    const requestPromise = useChatDebugStore.getState().requestDebug("sess-1", "run-1", "consumer-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("loading");

    useChatDebugStore.getState().cancelInterest("sess-1", "run-1", "consumer-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("idle");

    rejectPromise(new DOMException("The debug load request was aborted", "AbortError"));
    await requestPromise;
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("idle");
  });

  it("V10: purges cache when global debug is toggled OFF", async () => {
    const getFn = vi.fn().mockResolvedValue(makeTestSnapshot("run-1", "sess-1"));
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "c-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("ready");

    useDebugSettingsStore.setState({ showPromptDebug: false, showReasoningDebug: false });
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("idle");
  });

  it("V11: invalidates access and clears cache on daemon URL change", async () => {
    const getFn = vi.fn().mockResolvedValue(makeTestSnapshot("run-1", "sess-1"));
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "c-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("ready");

    useConnectionStore.getState().setUrl("http://127.0.0.1:18799");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("idle");
  });

  it("seeds cache from live snapshot so subsequent historical request hits cache", async () => {
    const getFn = vi.fn();
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    const snapshot = makeTestSnapshot("run-seeded", "sess-1", "Seeded system prompt");
    useChatDebugStore.getState().seedFromSnapshot(snapshot, "sess-1");

    const result = await useChatDebugStore.getState().requestDebug("sess-1", "run-seeded", "c-1");
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.systemPrompt).toBe("Seeded system prompt");
    expect(getFn).not.toHaveBeenCalled();
  });

  it("evicts run cache and state on evictRun", async () => {
    const getFn = vi.fn().mockResolvedValue(makeTestSnapshot("run-1", "sess-1"));
    setRunService({ get: getFn } as unknown as HttpRunAdapter);

    await useChatDebugStore.getState().requestDebug("sess-1", "run-1", "c-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("ready");

    useChatDebugStore.getState().evictRun("run-1");
    expect(useChatDebugStore.getState().getState("sess-1", "run-1").status).toBe("idle");
  });
});
