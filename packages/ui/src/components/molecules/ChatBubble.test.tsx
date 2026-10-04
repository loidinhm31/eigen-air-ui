// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBubble } from "./ChatBubble.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useChatDebugStore } from "../../stores/chat-debug-store.js";

describe("ChatBubble and ChatBubbleDebugDisclosure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useDebugSettingsStore.setState({ showPromptDebug: true, showReasoningDebug: true });
    useConnectionStore.setState({ sessionId: "session-1", url: "http://localhost:18790" });
    useChatDebugStore.setState({ states: {}, accessEpoch: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useDebugSettingsStore.setState({ showPromptDebug: false, showReasoningDebug: false });
    useChatDebugStore.setState({ states: {}, accessEpoch: 0 });
    vi.unstubAllGlobals();
  });

  it("renders assistant message and copy debug button when live debug is present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Hello from assistant",
          debug: {
            provider: "local_llama",
            model: "gemma-4-e4b-it-qat",
            system_prompt: "sys prompt",
            reasoning: { requested: true, available: true, text: "thought process" },
          },
        }}
      />
    );

    expect(screen.getByText("Hello from assistant")).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: /copy debug/i });
    expect(copyButton).toBeTruthy();
    expect(copyButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedJson = JSON.parse(writeText.mock.calls[0][0]);
    expect(copiedJson.message.content).toBe("Hello from assistant");
    expect(copiedJson.debug.provider).toBe("local_llama");
  });

  it("renders debug accordion with honest unavailable state when message has no run_id correlation", () => {
    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical message without debug",
        }}
      />
    );

    expect(screen.getByText("Historical message without debug")).toBeTruthy();
    expect(screen.getByText("Debug capture unavailable (no correlated run recorded).")).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: /copy debug/i });
    expect(copyButton).toBeTruthy();
    expect(copyButton.hasAttribute("disabled")).toBe(true);
  });

  it("returns null for tool messages or empty non-streaming assistant messages", () => {
    const { container: toolContainer } = render(
      <ChatBubble
        message={{
          role: "tool",
          content: "response_received",
        }}
      />
    );
    expect(toolContainer.firstChild).toBeNull();

    const { container: emptyContainer } = render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "",
        }}
      />
    );
    expect(emptyContainer.firstChild).toBeNull();
  });

  it("V01/V02: does not call requestDebug on initial render or remount when details is not opened", () => {
    const requestDebugSpy = vi.spyOn(useChatDebugStore.getState(), "requestDebug");

    const { rerender } = render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(requestDebugSpy).not.toHaveBeenCalled();

    rerender(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer updated",
          run_id: "run-abc",
        }}
      />
    );

    expect(requestDebugSpy).not.toHaveBeenCalled();
  });

  it("triggers requestDebug when user toggles details open for historical message with run_id", () => {
    const requestDebugSpy = vi.spyOn(useChatDebugStore.getState(), "requestDebug").mockResolvedValue({
      status: "loading",
    });

    const { container } = render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    const details = container.querySelector("details");
    expect(details).toBeTruthy();

    // Simulate opening the details
    details!.open = true;
    fireEvent(details!, new Event("toggle"));

    expect(requestDebugSpy).toHaveBeenCalledWith("session-1", "run-abc", expect.any(String));
  });

  it("resolves session ID from message.id when present, overriding connection sessionId", () => {
    const requestDebugSpy = vi.spyOn(useChatDebugStore.getState(), "requestDebug").mockResolvedValue({
      status: "loading",
    });

    const { container } = render(
      <ChatBubble
        message={{
          id: "msg-custom-sess-456-1-2",
          role: "assistant",
          content: "Historical answer with embedded session",
          run_id: "run-xyz",
        }}
      />
    );

    const details = container.querySelector("details");
    expect(details).toBeTruthy();

    details!.open = true;
    fireEvent(details!, new Event("toggle"));

    expect(requestDebugSpy).toHaveBeenCalledWith("custom-sess-456", "run-xyz", expect.any(String));
  });

  it("renders loading spinner and disabled copy button when historicalState is loading", () => {
    useChatDebugStore.setState({
      states: {
        "session-1::run-abc": { status: "loading" },
      },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(screen.getByText("Loading debug trace...")).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: /copy debug/i });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
  });

  it("renders ready historical debug data with provider, model, prompt, reasoning, and enabled copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    useChatDebugStore.setState({
      states: {
        "session-1::run-abc": {
          status: "ready",
          runId: "run-abc",
          provider: "openai_compatible",
          model: "gpt-4o",
          systemPrompt: "You are an assistant",
          reasoning: {
            available: true,
            text: "Deep reasoning steps",
            truncated: false,
          },
          expiresAtMs: Date.now() + 60000,
          isPartial: false,
        },
      },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(screen.getByText("openai_compatible")).toBeTruthy();
    expect(screen.getByText("gpt-4o")).toBeTruthy();
    expect(screen.getByText("You are an assistant")).toBeTruthy();
    expect(screen.getByText("Deep reasoning steps")).toBeTruthy();

    const copyButton = screen.getByRole("button", { name: /copy debug/i });
    expect(copyButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const trace = JSON.parse(writeText.mock.calls[0][0]);
    expect(trace.debug.provider).toBe("openai_compatible");
    expect(trace.debug.model).toBe("gpt-4o");
    expect(trace.debug.system_prompt).toBe("You are an assistant");
  });

  it("renders unavailable state with honest explanatory reason", () => {
    useChatDebugStore.setState({
      states: {
        "session-1::run-abc": {
          status: "unavailable",
          runId: "run-abc",
          reason: "expired",
        },
      },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(screen.getByText("Debug trace has expired and is no longer available.")).toBeTruthy();
    const copyButton = screen.getByRole("button", { name: /copy debug/i });
    expect(copyButton.hasAttribute("disabled")).toBe(true);
  });

  it("V16: renders unavailable state without fabricated provider or model placeholders", () => {
    useChatDebugStore.setState({
      states: {
        "session-1::run-abc": {
          status: "unavailable",
          runId: "run-abc",
          reason: "not_found",
        },
      },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(screen.getByText("Debug trace could not be found for this run.")).toBeTruthy();
    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.queryByText("Model")).toBeNull();
    expect(screen.queryByText("default")).toBeNull();
  });

  it("renders error state with retry button and clicking retry re-requests debug", () => {
    const requestDebugSpy = vi.spyOn(useChatDebugStore.getState(), "requestDebug").mockResolvedValue({
      status: "loading",
    });

    useChatDebugStore.setState({
      states: {
        "session-1::run-abc": {
          status: "error",
          runId: "run-abc",
          message: "Failed to connect to daemon",
          retryable: true,
        },
      },
    });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    expect(screen.getByText("Failed to connect to daemon")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeTruthy();

    fireEvent.click(retryButton);
    expect(requestDebugSpy).toHaveBeenCalledWith("session-1", "run-abc", expect.any(String));
  });

  it("does not trigger requestDebug on programmatic streaming auto-open", () => {
    const requestDebugSpy = vi.spyOn(useChatDebugStore.getState(), "requestDebug");

    const { container } = render(
      <ChatBubble
        isStreaming={true}
        message={{
          role: "assistant",
          content: "Streaming answer...",
          run_id: "run-live",
        }}
      />
    );

    const details = container.querySelector("details");
    expect(details).toBeTruthy();

    // Toggle event on streaming accordion
    fireEvent(details!, new Event("toggle"));

    expect(requestDebugSpy).not.toHaveBeenCalled();
  });

  it("cancels interest when details accordion is collapsed", () => {
    const cancelInterestSpy = vi.spyOn(useChatDebugStore.getState(), "cancelInterest");

    const { container } = render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical answer",
          run_id: "run-abc",
        }}
      />
    );

    const details = container.querySelector("details");
    expect(details).toBeTruthy();

    // Open first
    details!.open = true;
    fireEvent(details!, new Event("toggle"));

    // Then collapse
    details!.open = false;
    fireEvent(details!, new Event("toggle"));

    expect(cancelInterestSpy).toHaveBeenCalledWith("session-1", "run-abc", expect.any(String));
  });
});
