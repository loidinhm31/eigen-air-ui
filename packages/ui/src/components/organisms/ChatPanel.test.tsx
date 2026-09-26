// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
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
  questionServiceAvailable: true,
}));

class ResizeObserverMock {
  constructor(_callback: ResizeObserverCallback) {}

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
  getUserQuestionService: () => {
    if (!serviceMocks.questionServiceAvailable) throw new Error("question service unavailable");
    return {
      list: serviceMocks.listQuestions,
      get: serviceMocks.getQuestion,
      resolve: serviceMocks.resolveQuestion,
      cancel: serviceMocks.cancelQuestion,
    };
  },
  getRunService: () => ({ get: serviceMocks.getRunSnapshot }),
  getServiceAccessContext: () => ({}),
}));

const TEST_SKILL = {
  id: "code_review",
  name: "Code review",
  description: "Review code without exposing instructions",
};

const TEST_RUN_SNAPSHOT = {
  schema_version: 1,
  run: {
    run_id: "run-1",
    trace_id: "trace-1",
    session_id: "session-1",
    root_run_id: "run-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    agent_id: "agent-1",
    provider_id: "provider-1",
    channel: "web",
    lifecycle_status: "running",
    started_at_ms: 1,
    updated_at_ms: 1,
    snapshot_seq: 1,
    correlation_state: "active",
    redaction: { metadata_only: true, debug_requested: false, debug_available: false },
  },
  events: [],
  tool_calls: [],
  memory_lineage: [],
};

async function selectTestSkill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
  await user.click(await screen.findByRole("option", { name: /Code review/ }));
}

describe("ChatPanel selected skill lifecycle", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  afterEach(() => cleanup());

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    serviceMocks.sendMessage.mockReset();
    serviceMocks.getHistory.mockReset().mockResolvedValue({ messages: [] });
    serviceMocks.abort.mockReset().mockResolvedValue(undefined);
    serviceMocks.createSession.mockReset().mockResolvedValue({ id: "session-2" });
    serviceMocks.listSkills.mockReset().mockResolvedValue([TEST_SKILL]);
    serviceMocks.listQuestions.mockReset().mockResolvedValue({
      schema_version: "user_question.v1",
      questions: [],
      redaction: "metadata_only",
    });
    serviceMocks.getQuestion.mockReset();
    serviceMocks.resolveQuestion.mockReset();
    serviceMocks.cancelQuestion.mockReset();
    serviceMocks.getRunSnapshot.mockReset().mockResolvedValue(TEST_RUN_SNAPSHOT);
    serviceMocks.questionCallback = undefined;
    serviceMocks.questionServiceAvailable = true;
    useConnectionStore.setState({ status: "connected", sessionId: "session-1" });
    useChatStore.setState({
      messages: [],
      messageRevision: 0,
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
    });
    useDebugSettingsStore.setState({
      showPromptDebug: false,
      showReasoningDebug: false,
    });
    useReadinessStore.setState({
      phase: "ready",
      canInfer: true,
      snapshot: { status: "ready", retryable: false, details: { stages: [] } },
      error: null,
    });
  });

  it("keeps an agent question visible after the originating send promise completes", async () => {
    const question = {
      schema_version: "user_question.v1",
      question_id: "question-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "workspace-1",
      session_id: "session-1",
      run_id: "run-1",
      turn_index: 1,
      state: "pending",
      revision: 1,
      created_at_ms: 1,
      expires_at_ms: 2,
      terminal_at_ms: null,
      redaction: "metadata_only",
    } as const;
    const pendingList = {
      schema_version: "user_question.v1",
      questions: [question],
      redaction: "metadata_only",
    } as const;
    serviceMocks.listQuestions
      .mockResolvedValueOnce({
        schema_version: "user_question.v1",
        questions: [],
        redaction: "metadata_only",
      })
      .mockResolvedValue(pendingList);
    serviceMocks.getQuestion.mockResolvedValue({
      ...question,
      request: { kind: "short_text", prompt: "What should the note say?" },
      mutation_token: "a".repeat(32),
    });
    serviceMocks.sendMessage.mockImplementation(async () => {
      serviceMocks.questionCallback?.({
        type: "event",
        version: "v1",
        event: "user_question.updated",
        payload: { question_id: "question-1", state: "pending", revision: 1 },
      });
      return {
        status: "waiting_for_input",
        run_id: "run-1",
        question_id: "question-1",
        snapshot_ref: "user_question:question-1",
      };
    });
    const user = userEvent.setup();
    render(<ChatPanel />);

    await user.type(screen.getByPlaceholderText("Message nonclaw..."), "start");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledOnce());
    expect(await screen.findByRole("heading", { name: "Agent question" })).toBeTruthy();
    expect(useChatStore.getState().isStreaming).toBe(false);
    expect((screen.getByPlaceholderText("Message nonclaw...") as HTMLInputElement).disabled).toBe(
      true
    );
    const questionInput = screen.getByLabelText("What should the note say?");
    await user.type(questionInput, "red");
    await user.click(screen.getByRole("button", { name: "Answer" }));
    expect(await screen.findByText("red")).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "").not.toContain("red");
  });
  it("does not let a late history response overwrite newer messages", async () => {
    serviceMocks.questionServiceAvailable = false;
    let releaseHistory!: (history: { messages: [] }) => void;
    const staleHistory = new Promise<{ messages: [] }>((resolve) => {
      releaseHistory = resolve;
    });
    serviceMocks.getHistory.mockReset().mockImplementationOnce(() => staleHistory);
    render(<ChatPanel />);

    await waitFor(() => expect(serviceMocks.getHistory).toHaveBeenCalledOnce());
    useChatStore.getState().replaceMessages([{ role: "assistant", content: "resumed answer" }]);
    releaseHistory({ messages: [] });

    expect(await screen.findByText("resumed answer")).toBeTruthy();
    expect(useChatStore.getState().messages).toEqual([
      { role: "assistant", content: "resumed answer" },
    ]);
  });

  it("sends a selected ID once, then command choice clears the chip and stays ordinary text", async () => {
    serviceMocks.sendMessage.mockResolvedValue({ content: "done", tool_calls_made: 0 });
    const user = userEvent.setup();
    render(<ChatPanel />);

    await selectTestSkill(user);
    expect(screen.getByText("Skill: Code review")).toBeTruthy();

    const composer = screen.getByPlaceholderText("Message nonclaw...") as HTMLInputElement;
    await user.type(composer, "review this");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(serviceMocks.sendMessage.mock.calls[0]?.[3]).toMatchObject({
      selectedSkillId: "code_review",
    });
    expect(screen.queryByText("Skill: Code review")).toBeNull();

    await user.type(composer, "later ordinary message");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(2));
    expect(serviceMocks.sendMessage.mock.calls[1]?.[3]).not.toHaveProperty("selectedSkillId");

    await selectTestSkill(user);
    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    await user.click(screen.getByRole("option", { name: /!recall/ }));
    expect(screen.queryByText("Skill: Code review")).toBeNull();
    expect(composer.value).toBe("!recall ");

    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(3));
    expect(serviceMocks.sendMessage.mock.calls[2]?.[3]).not.toHaveProperty("selectedSkillId");
  });

  it("never carries a newly selected skill into Continue or a new chat", async () => {
    serviceMocks.sendMessage
      .mockResolvedValueOnce({ content: "partial", tool_calls_made: 1, can_continue: true })
      .mockResolvedValueOnce({ content: "complete", tool_calls_made: 0 });
    const user = userEvent.setup();
    render(<ChatPanel />);

    const composer = screen.getByPlaceholderText("Message nonclaw...");
    await user.type(composer, "start");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("button", { name: "Continue" });

    await selectTestSkill(user);
    expect(screen.getByText("Skill: Code review")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(2));
    expect(serviceMocks.sendMessage.mock.calls[1]?.[3]).toMatchObject({
      allowToolLimitContinue: true,
    });
    expect(serviceMocks.sendMessage.mock.calls[1]?.[3]).not.toHaveProperty("selectedSkillId");
    expect(screen.queryByText("Skill: Code review")).toBeNull();

    await selectTestSkill(user);
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(serviceMocks.createSession).toHaveBeenCalledOnce());
    expect(screen.queryByText("Skill: Code review")).toBeNull();
  });

  it("keeps a selected-skill server rejection visible without choosing a replacement", async () => {
    serviceMocks.sendMessage.mockRejectedValue(
      new Error("Selected skill is unavailable. Refresh the skill list or remove the selection.")
    );
    const user = userEvent.setup();
    render(<ChatPanel />);

    await selectTestSkill(user);
    await user.type(screen.getByPlaceholderText("Message nonclaw..."), "review this");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText(
        /Selected skill is unavailable\. Refresh the skill list or remove the selection\./
      )
    ).toBeTruthy();
    expect(screen.queryByText("Skill: Code review")).toBeNull();
    expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(1);

    serviceMocks.sendMessage.mockResolvedValueOnce({ content: "retry done", tool_calls_made: 0 });
    await user.type(screen.getByPlaceholderText("Message nonclaw..."), "manual retry");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledTimes(2));
    expect(serviceMocks.sendMessage.mock.calls[1]?.[3]).not.toHaveProperty("selectedSkillId");
  });

  it("clears selection across reconnect and history session changes", async () => {
    serviceMocks.sendMessage.mockResolvedValue({ content: "done", tool_calls_made: 0 });
    const user = userEvent.setup();
    render(<ChatPanel />);

    await selectTestSkill(user);
    useConnectionStore.getState().setStatus("disconnected");
    await waitFor(() => expect(screen.queryByText("Skill: Code review")).toBeNull());

    useConnectionStore.getState().setStatus("connected");
    await selectTestSkill(user);
    useConnectionStore.getState().setSessionId("history-session");
    await waitFor(() => expect(screen.queryByText("Skill: Code review")).toBeNull());

    await user.type(screen.getByPlaceholderText("Message nonclaw..."), "after history change");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(serviceMocks.sendMessage).toHaveBeenCalledOnce());
    expect(serviceMocks.sendMessage.mock.calls[0]?.[3]).not.toHaveProperty("selectedSkillId");
  });

  it("keeps built-in commands usable when skill discovery fails synchronously", async () => {
    serviceMocks.listSkills.mockImplementationOnce(() => {
      throw new Error("service not initialized");
    });
    const user = userEvent.setup();
    render(<ChatPanel />);

    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    expect(await screen.findByText(/Installed skills unavailable/)).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /!count/ }));

    const composer = screen.getByPlaceholderText("Message nonclaw...") as HTMLInputElement;
    expect(composer.value).toBe("!count");
    expect(document.activeElement).toBe(composer);
    expect(serviceMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("opens suggestions from an empty composer slash without inserting or sending it", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);

    const composer = screen.getByPlaceholderText("Message nonclaw...") as HTMLInputElement;
    await user.click(composer);
    await user.keyboard("/");

    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Search commands and installed skills" })
    );
    expect(screen.getByRole("option", { name: /!remember/ })).toBeTruthy();
    expect(composer.value).toBe("");
    expect(serviceMocks.sendMessage).not.toHaveBeenCalled();
  });

  it("renders live debug while keeping prompt and reasoning out of storage", async () => {
    useDebugSettingsStore.setState({
      showPromptDebug: true,
      showReasoningDebug: true,
    });
    serviceMocks.sendMessage.mockResolvedValue({
      content: "debugged answer",
      tool_calls_made: 0,
      debug: {
        provider: "provider",
        model: "model",
        system_prompt: "live-prompt-fixture",
        reasoning: {
          requested: true,
          available: true,
          text: "live-reasoning-fixture",
        },
      },
    });
    const user = userEvent.setup();
    render(<ChatPanel />);

    await user.type(screen.getByPlaceholderText("Message nonclaw..."), "show debug");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("live-prompt-fixture")).toBeTruthy();
    expect(await screen.findByText("live-reasoning-fixture")).toBeTruthy();
    expect(useChatStore.getState().messages.at(-1)?.debug?.system_prompt).toBe(
      "live-prompt-fixture"
    );

    const persisted = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    expect(persisted).not.toContain("live-prompt-fixture");
    expect(persisted).not.toContain("live-reasoning-fixture");
    expect(JSON.parse(persisted).state.messages.at(-1).debug).toBeUndefined();
  });

  it("blocks composer and displays loading placeholder when model is starting", () => {
    useReadinessStore.setState({
      phase: "starting",
      canInfer: false,
      snapshot: {
        status: "starting",
        retryable: true,
        details: { stages: [{ name: "model_load", status: "running" }] },
      },
      error: null,
    });
    render(<ChatPanel />);

    const composer = screen.getByPlaceholderText("Model is loading...");
    expect(composer.hasAttribute("disabled")).toBe(true);
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn.hasAttribute("disabled")).toBe(true);
  });

  it("blocks composer and displays disconnected placeholder when disconnected", () => {
    useConnectionStore.setState({ status: "disconnected" });
    render(<ChatPanel />);

    const composer = screen.getByPlaceholderText("Connect to nonclaw to start...");
    expect(composer.hasAttribute("disabled")).toBe(true);
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn.hasAttribute("disabled")).toBe(true);
  });

  it("restores input draft when message submission fails", async () => {
    serviceMocks.sendMessage.mockRejectedValue(new Error("Provider is starting; retry shortly."));
    const user = userEvent.setup();
    render(<ChatPanel />);

    const composer = screen.getByPlaceholderText("Message nonclaw...");
    await user.type(composer, "my important question");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/Provider is starting; retry shortly\./)).toBeTruthy();
    const inputEl = screen.getByPlaceholderText("Message nonclaw...") as HTMLInputElement;
    expect(inputEl.value).toBe("my important question");
    expect(useChatStore.getState().messages).toHaveLength(0);
  });
});
