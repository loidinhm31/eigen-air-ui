// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { ChatPanel } from "./ChatPanel.js";

const serviceMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getHistory: vi.fn(),
  abort: vi.fn(),
  createSession: vi.fn(),
  listSkills: vi.fn(),
}));

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    sendMessage: serviceMocks.sendMessage,
    getHistory: serviceMocks.getHistory,
    abort: serviceMocks.abort,
  }),
  getSessionService: () => ({ createSession: serviceMocks.createSession }),
  getSkillService: () => ({ list: serviceMocks.listSkills }),
}));

const TEST_SKILL = {
  id: "code_review",
  name: "Code review",
  description: "Review code without exposing instructions",
};

async function selectTestSkill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
  await user.click(await screen.findByRole("option", { name: /Code review/ }));
}

describe("ChatPanel selected skill lifecycle", () => {
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
    useConnectionStore.setState({ status: "connected", sessionId: "session-1" });
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
    });
    useDebugSettingsStore.setState({
      showPromptDebug: false,
      showReasoningDebug: false,
    });
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
});
