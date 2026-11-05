// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { useChatStore } from "../../stores/chatStore.js";

const serviceMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  sendMessage: vi.fn(),
  getHistory: vi.fn(),
  abort: vi.fn(),
  listSkills: vi.fn(),
  listQuestions: vi.fn(),
  listApprovals: vi.fn(),
  getQuestion: vi.fn(),
  getRun: vi.fn(),
}));
vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    sendMessage: serviceMocks.sendMessage,
    getHistory: serviceMocks.getHistory,
    abort: serviceMocks.abort,
  }),
  getSessionService: () => ({
    createSession: serviceMocks.createSession,
    getSession: serviceMocks.getSession,
    listSessions: serviceMocks.listSessions,
  }),
  getSkillService: () => ({ list: serviceMocks.listSkills }),
  getUserQuestionService: () => ({
    list: serviceMocks.listQuestions,
    get: serviceMocks.getQuestion,
  }),
  getToolApprovalService: () => ({
    list: serviceMocks.listApprovals,
  }),
  getRunService: () => ({ get: serviceMocks.getRun }),
  getServiceAccessContext: () => ({ accessRevision: 1 }),
  registerAccessInvalidationListener: () => () => undefined,
}));

vi.mock("../../embed/base-path-navigation.js", () => ({
  useBasePathNavigation: () => ({ navigate: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useConnectionStore.setState({
    status: "connected",
    sessionId: "sess-dev-1",
    url: "http://daemon:18790",
  });
  serviceMocks.getHistory.mockResolvedValue({ messages: [] });
  serviceMocks.listSkills.mockResolvedValue([]);
  serviceMocks.listQuestions.mockResolvedValue({ schema_version: "user_question.v1", questions: [] });
  serviceMocks.listApprovals.mockResolvedValue([]);
});

describe("ChatPanel target-aware readiness and progress", () => {
  it("allows message composition when client device is active even if server provider is failed", async () => {
    // Server provider is failed
    useReadinessStore.setState({
      phase: "failed",
      canInfer: false,
      error: "GPU out of memory",
    });

    // Session is bound to active client device
    serviceMocks.getSession.mockResolvedValue({
      id: "sess-dev-1",
      channel: "ws",
      status: "active",
      execution_target: {
        kind: "client_device",
        device_id: "dev-mac-1",
        model_artifact_id: "gemma-4",
        binding_revision: 1,
      },
    });

    // Active device in inferenceStore
    useInferenceStore.setState({
      devices: [
        {
          device_id: "dev-mac-1",
          display_label: "My M3 Mac",
          status: "active",
          warning_archived: false,
          protocol_min_version: "1.0",
          protocol_max_version: "1.0",
          runtime_metadata: {},
          created_at: 100,
          updated_at: 200,
          revision: 1,
        },
      ],
    });

    render(<ChatPanel />);

    await vi.waitFor(() => {
      expect(serviceMocks.getSession).toHaveBeenCalledWith("sess-dev-1");
      expect(serviceMocks.listSessions).not.toHaveBeenCalled();
    });

    const input = await screen.findByPlaceholderText("Message eigen-air...");
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).disabled).toBe(false);
  });

  it("blocks message composition and displays target alert when client device is offline or revoked", async () => {
    // Session is bound to client device
    serviceMocks.getSession.mockResolvedValue({
      id: "sess-dev-1",
      channel: "ws",
      status: "active",
      execution_target: {
        kind: "client_device",
        device_id: "dev-mac-1",
        model_artifact_id: "gemma-4",
        binding_revision: 1,
      },
    });

    // Revoked device
    useInferenceStore.setState({
      devices: [
        {
          device_id: "dev-mac-1",
          display_label: "My M3 Mac",
          status: "revoked",
          warning_archived: false,
          protocol_min_version: "1.0",
          protocol_max_version: "1.0",
          runtime_metadata: {},
          created_at: 100,
          updated_at: 200,
          revision: 1,
        },
      ],
    });

    render(<ChatPanel />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Target My M3 Mac unavailable: Device is revoked");
    const input = screen.getByPlaceholderText("Device is revoked") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("renders measured generation counters during streaming when progress is active", async () => {
    useChatStore.setState({
      isStreaming: true,
      streamingContent: "Hello world",
    });
    useInferenceStore.setState({
      runProgress: {
        "sess-dev-1:run-10:0": {
          schema_version: "run.inference.v1",
          session_id: "sess-dev-1",
          run_id: "run-10",
          turn_index: 0,
          stage: "generate",
          stage_instance_id: "gen-0",
          attempt_id: 1,
          status: "active",
          revision: 5,
          elapsed_ms: 2400,
          occurred_at_ms: Date.now(),
          counters: {
            generated_tokens: 42,
            tokens_per_second: 18.5,
            reused_prompt_tokens: 128,
          },
        },
      },
    });
    render(<ChatPanel />);
    await vi.waitFor(() => expect(serviceMocks.getSession).toHaveBeenCalledWith("sess-dev-1"));
    expect(serviceMocks.listSessions).not.toHaveBeenCalled();
    act(() => {
      useChatStore.getState().beginStream("Thinking...");
    });

    expect(await screen.findByText("generate")).toBeTruthy();
    expect(screen.getByText("42 tokens")).toBeTruthy();
    expect(screen.getByText("(18.5 t/s)")).toBeTruthy();
    expect(screen.getByText("reused: 128")).toBeTruthy();
  });

  it("UI-07: reactively blocks and unblocks composer when pool qualified models transition", async () => {
    // Pool initially has only qwen-3.5 qualified
    useInferenceStore.setState({
      pools: {
        "pool-qa": {
          pool_id: "pool-qa",
          ready_hosts: 1,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: ["qwen-3.5-9b-ud-q4_k_xl"],
        },
      },
      hosts: {
        "host-qa": {
          host_id: "host-qa",
          installation_id: "i-qa",
          label: "QA Host",
          platform: "linux",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: 1000,
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          current_binding: {
            host_id: "host-qa",
            pool_id: "pool-qa",
            state: "bound",
            revision: 1,
            changed_at_ms: 1000,
          },
          recovery: {
            desired_revision: 1,
            reconciled_revision: 1,
            auto_load_model: true,
            auto_prepare_kv: false,
            model_ready: true,
            cache_ready: true,
            model_action: "none",
            cache_action: "none",
          },
        },
      },
    });

    // Session targets gemma-4 in pool-qa (which is NOT qualified yet)
    serviceMocks.getSession.mockResolvedValue({
      id: "sess-dev-1",
      title: "QA Pool Session",
      created_at: 100,
      updated_at: 200,
      inference_target: {
        kind: "pool",
        pool_id: "pool-qa",
        model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        model_digest: "df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3",
      },
    });

    render(<ChatPanel />);
    await vi.waitFor(() => expect(serviceMocks.getSession).toHaveBeenCalledWith("sess-dev-1"));
    expect(serviceMocks.listSessions).not.toHaveBeenCalled();

    // Target alert should show model is not qualified in pool
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not qualified in pool pool-qa");
    const input = screen.getByPlaceholderText(/not qualified in pool/) as HTMLInputElement;
    expect(input.disabled).toBe(true);

    // Now pool transitions dynamically to qualify gemma-4
    act(() => {
      useInferenceStore.setState({
        pools: {
          "pool-qa": {
            pool_id: "pool-qa",
            ready_hosts: 1,
            busy_hosts: 0,
            offline_hosts: 0,
            qualified_models: ["qwen-3.5-9b-ud-q4_k_xl", "gemma-4-e4b-it-qat-ud-q4_k_xl"],
          },
        },
      });
    });

    // Composer reactively unblocks without page reload or server readiness change
    await vi.waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
      const activeInput = screen.getByPlaceholderText("Message eigen-air...") as HTMLInputElement;
      expect(activeInput.disabled).toBe(false);
    });
  });

  it("falls back to default server target when getSession returns null and never calls listSessions", async () => {
    useReadinessStore.setState({
      phase: "ready",
      canInfer: true,
    });
    serviceMocks.getSession.mockResolvedValue(null);

    render(<ChatPanel />);

    await vi.waitFor(() => {
      expect(serviceMocks.getSession).toHaveBeenCalledWith("sess-dev-1");
      expect(serviceMocks.listSessions).not.toHaveBeenCalled();
    });

    const input = await screen.findByPlaceholderText("Message eigen-air...");
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sets targetLookupFailed when getSession throws and renders failure alert", async () => {
    serviceMocks.getSession.mockRejectedValue(new Error("network failure"));

    render(<ChatPanel />);

    await vi.waitFor(() => {
      expect(serviceMocks.getSession).toHaveBeenCalledWith("sess-dev-1");
      expect(serviceMocks.listSessions).not.toHaveBeenCalled();
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Failed to resolve session target.");
  });
});
