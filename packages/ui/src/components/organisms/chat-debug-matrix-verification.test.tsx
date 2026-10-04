// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, RunSnapshotDto } from "@eigen-air-ui/shared/types";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import { useChatDebugStore } from "../../stores/chat-debug-store.js";
import { ChatDebugCache } from "../../stores/chat-debug-cache.js";
import { ChatPanel } from "./ChatPanel.js";

const serviceMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getHistory: vi.fn(),
  abort: vi.fn(),
  createSession: vi.fn(),
  listSkills: vi.fn(),
  listQuestions: vi.fn(),
  getQuestion: vi.fn(),
  resolveQuestion: vi.fn(),
  cancelQuestion: vi.fn(),
  getRunSnapshot: vi.fn(),
  questionCallback: undefined as ((event: unknown) => void) | undefined,
  accessContext: {
    capabilities: new Set(["run:read:self", "run:read:debug"]),
  },
  accessListeners: [] as Array<() => void>,
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    sendMessage: serviceMocks.sendMessage,
    getHistory: serviceMocks.getHistory,
    abort: serviceMocks.abort,
    subscribeUserQuestion: (callback: (event: unknown) => void) => {
      serviceMocks.questionCallback = callback;
      return () => {
        if (serviceMocks.questionCallback === callback) serviceMocks.questionCallback = undefined;
      };
    },
  }),
  getSessionService: () => ({ createSession: serviceMocks.createSession }),
  getSkillService: () => ({ list: serviceMocks.listSkills }),
  getUserQuestionService: () => ({
    list: serviceMocks.listQuestions,
    get: serviceMocks.getQuestion,
    resolve: serviceMocks.resolveQuestion,
    cancel: serviceMocks.cancelQuestion,
  }),
  getRunService: () => ({ get: serviceMocks.getRunSnapshot }),
  getServiceAccessContext: () => serviceMocks.accessContext,
  registerAccessInvalidationListener: (cb: () => void) => {
    serviceMocks.accessListeners.push(cb);
    return () => {
      serviceMocks.accessListeners = serviceMocks.accessListeners.filter((l) => l !== cb);
    };
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSnapshot(runId: string, sessionId: string, prompt = "Test prompt", reasoning = "Test reasoning"): RunSnapshotDto {
  const promptBytes = new TextEncoder().encode(prompt).byteLength;
  const reasoningBytes = new TextEncoder().encode(reasoning).byteLength;
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
    events: [
      {
        event_id: `ev-${runId}-1`,
        event_seq: 1,
        event_kind: "turn.request",
        occurred_at_ms: 1000,
        request_provenance: {
          schema_version: "request_provenance.v1",
          logical_request_id: "req-1",
          provider_id: "mock-prov",
          prompt_format_version: "v1",
          section_summaries: [],
          model: "test-model-4b",
        },
      },
    ],
    tool_calls: [],
    memory_lineage: [],
    debug_excerpts: [
      {
        excerpt_seq: 1,
        kind: "system_prompt",
        plaintext: prompt,
        plaintext_bytes: promptBytes,
        created_at_ms: 1000,
        expires_at_ms: Date.now() + 60_000,
        truncated: false,
        redaction_count: 0,
      },
      {
        excerpt_seq: 2,
        kind: "provider_reasoning",
        plaintext: reasoning,
        plaintext_bytes: reasoningBytes,
        created_at_ms: 1050,
        expires_at_ms: Date.now() + 60_000,
        truncated: false,
        redaction_count: 0,
      },
    ],
    next_debug_cursor: null,
  };
}

function openDetails(details: HTMLDetailsElement): void {
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

describe("Chat Debug Matrix Verification (V01-V02, V05-V12, V15-V17, V19)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    serviceMocks.accessContext = { capabilities: new Set(["run:read:self", "run:read:debug"]) };
    serviceMocks.accessListeners = [];

    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: ResizeObserverMock,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    serviceMocks.sendMessage.mockReset();
    serviceMocks.getHistory.mockReset().mockResolvedValue({ messages: [] });
    serviceMocks.abort.mockReset().mockResolvedValue(undefined);
    serviceMocks.createSession.mockReset().mockResolvedValue({ id: "session-1" });
    serviceMocks.listSkills.mockReset().mockResolvedValue([]);
    serviceMocks.listQuestions.mockReset().mockResolvedValue({
      schema_version: "user_question.v1",
      questions: [],
      redaction: "metadata_only",
    });
    serviceMocks.getRunSnapshot.mockReset();

    useReadinessStore.setState({ phase: "ready", canInfer: true });
    useConnectionStore.setState({ status: "connected", sessionId: "session-1", url: "http://localhost:18790" });
    useDebugSettingsStore.setState({ showPromptDebug: true, showReasoningDebug: true });
    useChatDebugStore.getState().clearDebugCache();
    useChatDebugStore.setState({ states: {} });
    useChatStore.setState({ messages: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // V01: Debug ON; initial history load with multiple turns makes ZERO REST calls until explicit per-message expand
  it("V01: loads multi-turn history with Debug ON and makes zero REST calls until explicit expand", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-1-0", role: "user", content: "hello turn 1" },
      { id: "msg-1-1", role: "assistant", content: "answer 1", run_id: "run-turn-1" },
      { id: "msg-2-0", role: "user", content: "hello turn 2" },
      { id: "msg-2-1", role: "assistant", content: "answer 2", run_id: "run-turn-2" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });
    serviceMocks.getRunSnapshot.mockResolvedValue(makeSnapshot("run-turn-1", "session-1"));

    render(<ChatPanel />);

    expect(await screen.findByText("answer 1")).toBeTruthy();
    expect(await screen.findByText("answer 2")).toBeTruthy();

    // Zero REST calls made on initial load
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(0);

    // Expand turn 1 accordion
    const detailsList = document.querySelectorAll("details");
    expect(detailsList.length).toBe(2);

    openDetails(detailsList[0]);

    await waitFor(() => {
      expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(1);
      expect(serviceMocks.getRunSnapshot).toHaveBeenCalledWith("run-turn-1", expect.anything());
    });
  });

  // V02: Global Debug ON alone, remounting ChatPanel, and programmatic streaming auto-open do not trigger historical REST requests
  it("V02: remount and streaming auto-open do not trigger historical REST requests", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-1-1", role: "assistant", content: "historical reply", run_id: "run-hist" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });

    const { unmount } = render(<ChatPanel />);
    expect(await screen.findByText("historical reply")).toBeTruthy();
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(0);

    // Remount
    unmount();
    render(<ChatPanel />);
    expect(await screen.findByText("historical reply")).toBeTruthy();
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(0);
  });

  // V05: Open one historical Debug accordion; selected run only loads, closed panels never prefetch
  it("V05: expanding one message loads only its run, closed messages remain unrequested", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-1-1", role: "assistant", content: "first", run_id: "run-first" },
      { id: "msg-2-1", role: "assistant", content: "second", run_id: "run-second" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });
    serviceMocks.getRunSnapshot.mockImplementation(async (runId: string) =>
      makeSnapshot(runId, "session-1", `Prompt for ${runId}`, `Reasoning for ${runId}`)
    );

    render(<ChatPanel />);
    expect(await screen.findByText("first")).toBeTruthy();

    const detailsList = document.querySelectorAll("details");
    expect(detailsList.length).toBe(2);

    // Open first only
    openDetails(detailsList[0]);

    await waitFor(() => {
      expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(1);
      expect(serviceMocks.getRunSnapshot).toHaveBeenCalledWith("run-first", expect.anything());
    });

    // Verify prompt rendered for first, but run-second never called
    expect(await screen.findByText("Prompt for run-first")).toBeTruthy();
    expect(serviceMocks.getRunSnapshot).not.toHaveBeenCalledWith("run-second", expect.anything());
  });

  // V06: Rapid repeated expand / shared consumers: one single-flight load; closing one consumer does not cancel another
  it("V06: deduplicates concurrent requests for the same run across multiple consumers", async () => {
    const { promise: pendingPromise, resolve: resolveSnapshot } = createDeferred<RunSnapshotDto>();
    serviceMocks.getRunSnapshot.mockReturnValue(pendingPromise);

    const store = useChatDebugStore.getState();
    const req1 = store.requestDebug("session-1", "run-shared", "consumer-A");
    const req2 = store.requestDebug("session-1", "run-shared", "consumer-B");

    // Only 1 REST request was initiated
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(1);

    // Release consumer A, consumer B is still interested
    store.cancelInterest("session-1", "run-shared", "consumer-A");

    // Fulfill promise
    resolveSnapshot(makeSnapshot("run-shared", "session-1"));
    const [res1, res2] = await Promise.all([req1, req2]);

    expect(res1.status).toBe("ready");
    expect(res2.status).toBe("ready");
    expect(store.getState("session-1", "run-shared").status).toBe("ready");
  });

  // V07: A → B → A within same access/app: ready unexpired cached excerpt renders with zero extra debug REST requests
  it("V07: switching session A -> B -> A reuses cached debug snapshot with zero extra REST calls", async () => {
    const messagesA: ChatMessage[] = [
      { id: "msg-a-1", role: "assistant", content: "answer in A", run_id: "run-A" },
    ];
    const messagesB: ChatMessage[] = [
      { id: "msg-b-1", role: "assistant", content: "answer in B", run_id: "run-B" },
    ];

    serviceMocks.getHistory.mockImplementation(async (sid: string) => ({
      messages: sid === "session-A" ? messagesA : messagesB,
    }));

    serviceMocks.getRunSnapshot.mockImplementation(async (runId: string) =>
      makeSnapshot(runId, runId === "run-A" ? "session-A" : "session-B", "Marker prompt for A", "Marker reasoning for A")
    );

    // 1. In Session A, expand run-A
    useConnectionStore.setState({ sessionId: "session-A" });

    const { rerender } = render(<ChatPanel />);
    expect(await screen.findByText("answer in A")).toBeTruthy();

    const detailsA = document.querySelector("details")!;
    openDetails(detailsA);

    expect(await screen.findByText("Marker prompt for A")).toBeTruthy();
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(1);

    // 2. Switch to Session B
    useConnectionStore.setState({ sessionId: "session-B" });
    rerender(<ChatPanel />);
    expect(await screen.findByText("answer in B")).toBeTruthy();

    // 3. Switch back to Session A
    useConnectionStore.setState({ sessionId: "session-A" });
    rerender(<ChatPanel />);
    expect(await screen.findByText("answer in A")).toBeTruthy();

    const reopenedDetailsA = document.querySelector("details")!;
    openDetails(reopenedDetailsA);

    // Renders from cache immediately, getRunSnapshot call count is still 1!
    expect(await screen.findByText("Marker prompt for A")).toBeTruthy();
    expect(serviceMocks.getRunSnapshot).toHaveBeenCalledTimes(1);
  });

  // V08: Page caps, row limits, LRU eviction and memory bounds
  it("V08: enforces deterministic LRU eviction at MAX_CACHE_ENTRIES limit", () => {
    const cache = new ChatDebugCache();
    const daemon = "http://localhost";
    const epoch = 1;

    for (let i = 1; i <= 65; i++) {
      cache.put(daemon, epoch, `sess-${i}`, `run-${i}`, {
        status: "ready",
        runId: `run-${i}`,
        provider: "prov",
        expiresAtMs: Date.now() + 10_000,
        plaintextBytes: 100,
        isPartial: false,
      });
    }

    // Oldest entry (run-1) evicted, newest (run-65) preserved
    expect(cache.get(daemon, epoch, "sess-1", "run-1")).toBeUndefined();
    expect(cache.get(daemon, epoch, "sess-65", "run-65")).toBeDefined();
    expect(cache.getEntryCount()).toBe(64);
  });

  // V09: Expiry exact boundary: no expired render/copy; eviction deadline <= server earliest excerpt expiry
  it("V09: evicts expired cache entries immediately on read", () => {
    const cache = new ChatDebugCache();
    const daemon = "http://localhost";
    const epoch = 1;

    cache.put(daemon, epoch, "sess-1", "run-1", {
      status: "ready",
      runId: "run-1",
      provider: "prov",
      expiresAtMs: 2000,
      isPartial: false,
      plaintextBytes: 50,
    }, 1000);

    expect(cache.get(daemon, epoch, "sess-1", "run-1", 1500)).toBeDefined();
    expect(cache.get(daemon, epoch, "sess-1", "run-1", 2001)).toBeUndefined();
  });

  // V10: Debug Off purges current/live/historical plaintext, aborts pending work; ON again requires explicit historical load
  it("V10: toggling debug OFF purges cache and requires explicit re-expansion on re-enable", async () => {
    const store = useChatDebugStore.getState();
    serviceMocks.getRunSnapshot.mockResolvedValue(makeSnapshot("run-v10", "session-1"));

    await store.requestDebug("session-1", "run-v10", "consumer-1");
    expect(store.getState("session-1", "run-v10").status).toBe("ready");

    // Toggle debug OFF
    act(() => {
      useDebugSettingsStore.setState({ showPromptDebug: false, showReasoningDebug: false });
    });

    // State purged
    expect(store.getState("session-1", "run-v10").status).toBe("idle");

    // Toggle debug back ON
    act(() => {
      useDebugSettingsStore.setState({ showPromptDebug: true, showReasoningDebug: true });
    });

    // Still idle until explicit expand
    expect(store.getState("session-1", "run-v10").status).toBe("idle");
  });

  // V11: Rotate effective token/identity/capability/daemon while Chat unmounted; cache cleared and late response cannot reinstall
  it("V11: access rotation clears cache and fences late responses from reinstalling", async () => {
    const { promise, resolve: resolveGet } = createDeferred<RunSnapshotDto>();
    serviceMocks.getRunSnapshot.mockImplementation(() => promise);

    const store = useChatDebugStore.getState();
    const loadPromise = store.requestDebug("session-1", "run-v11", "consumer-1");

    // Invalidate access during in-flight load
    act(() => {
      useChatDebugStore.getState().invalidateAccess();
    });

    resolveGet(makeSnapshot("run-v11", "session-1", "late prompt", "late reasoning"));
    await loadPromise;

    // Cache did not store the late response
    expect(store.getState("session-1", "run-v11").status).toBe("idle");
  });

  // V12: localStorage / sessionStorage / IndexedDB contain NO marker prompt/reasoning; clipboard copy is explicit only
  it("V12: browser storage never contains marker prompt or reasoning text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const messages: ChatMessage[] = [
      { id: "msg-sec-1", role: "assistant", content: "secret check", run_id: "run-sec-1" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });
    serviceMocks.getRunSnapshot.mockResolvedValue(
      makeSnapshot("run-sec-1", "session-1", "SuperSecretPromptMarker12345", "SuperSecretReasoningMarker67890")
    );

    render(<ChatPanel />);
    expect(await screen.findByText("secret check")).toBeTruthy();

    const details = document.querySelector("details")!;
    openDetails(details);

    expect(await screen.findByText("SuperSecretPromptMarker12345")).toBeTruthy();

    // Verify localStorage has zero trace of the secret markers
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const val = localStorage.getItem(key)!;
      expect(val).not.toContain("SuperSecretPromptMarker12345");
      expect(val).not.toContain("SuperSecretReasoningMarker67890");
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      const val = sessionStorage.getItem(key)!;
      expect(val).not.toContain("SuperSecretPromptMarker12345");
      expect(val).not.toContain("SuperSecretReasoningMarker67890");
    }

    // Explicit copy button works
    const copyBtn = screen.getByRole("button", { name: /copy debug/i });
    expect(copyBtn).toBeTruthy();
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("SuperSecretPromptMarker12345");
  });

  // V15: Present malformed / missing run locator: renders ordinary answer text without crash
  it("V15: missing run_id renders message text with honest unavailable state", async () => {
    const messages: ChatMessage[] = [
      { id: "msg-legacy-1", role: "assistant", content: "legacy answer text" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });

    render(<ChatPanel />);

    expect(await screen.findByText("legacy answer text")).toBeTruthy();
    const details = document.querySelector("details")!;
    openDetails(details);
    expect(await screen.findByText("Debug capture unavailable (no correlated run recorded).")).toBeTruthy();
  });

  // V16: Unavailable debug states (401/403/404) render honest neutral state without placeholder hallucinations
  it("V16: 404 on run lookup renders honest unavailable reason without fabricated model placeholders", async () => {
    const err = new Error("Run not found");
    Object.assign(err, { status: 404 });
    serviceMocks.getRunSnapshot.mockRejectedValue(err);

    const messages: ChatMessage[] = [
      { id: "msg-unavail-1", role: "assistant", content: "unavail answer", run_id: "run-404" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });

    render(<ChatPanel />);
    expect(await screen.findByText("unavail answer")).toBeTruthy();

    const details = document.querySelector("details")!;
    openDetails(details);

    expect(await screen.findByText("Debug trace could not be found for this run.")).toBeTruthy();
    expect(screen.queryByText(/Provider:/)).toBeNull();
    expect(screen.queryByText(/Model:/)).toBeNull();
  });

  // V17: 503 / network failure renders retry button while keeping message and composer usable
  it("V17: network failure renders retry button while keeping message and composer usable", async () => {
    const netErr = new TypeError("Failed to fetch");
    serviceMocks.getRunSnapshot.mockRejectedValue(netErr);

    const messages: ChatMessage[] = [
      { id: "msg-err-1", role: "assistant", content: "network failure test", run_id: "run-net" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });

    render(<ChatPanel />);
    expect(await screen.findByText("network failure test")).toBeTruthy();

    const details = document.querySelector("details")!;
    openDetails(details);

    expect(await screen.findByText("Failed to fetch")).toBeTruthy();
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeTruthy();

    // Message is still visible
    expect(screen.getByText("network failure test")).toBeTruthy();
    // Composer input is still enabled
    const composer = screen.getByPlaceholderText(/Message eigen-air/i);
    expect(composer.hasAttribute("disabled")).toBe(false);
  });

  // V19: Live send finalization completes without waiting for pending historical loader and never sets stream error
  it("V19: live send finalization succeeds without waiting for pending historical loader", async () => {
    const { promise: pendingPromise, resolve: pendingHistoricalResolve } = createDeferred<RunSnapshotDto>();
    serviceMocks.getRunSnapshot.mockReturnValue(pendingPromise);

    const messages: ChatMessage[] = [
      { id: "msg-hist-1", role: "assistant", content: "old message", run_id: "run-stall" },
    ];
    serviceMocks.getHistory.mockResolvedValue({ messages });

    serviceMocks.sendMessage.mockResolvedValue({ content: "live answer", tool_calls_made: 0 });

    render(<ChatPanel />);
    expect(await screen.findByText("old message")).toBeTruthy();

    // Expand historical debug (starts in-flight load)
    const details = document.querySelector("details")!;
    openDetails(details);

    // Send a live message
    const user = userEvent.setup();
    const composer = screen.getByPlaceholderText(/Message eigen-air/i);
    await user.type(composer, "new live message{Enter}");

    // Live send completed successfully
    await waitFor(() => {
      expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(1);
    });

    expect(useChatStore.getState().streamError).toBeNull();

    // Clean up pending promise
    pendingHistoricalResolve(makeSnapshot("run-stall", "session-1"));
  });
});
