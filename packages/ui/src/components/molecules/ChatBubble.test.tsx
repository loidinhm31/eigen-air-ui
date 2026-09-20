// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import { ChatBubble } from "./ChatBubble.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";

describe("ChatBubble", () => {
  it("renders assistant message and copy debug button when debug is present", async () => {
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

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeTruthy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedJson = JSON.parse(writeText.mock.calls[0][0]);
    expect(copiedJson.message.content).toBe("Hello from assistant");
    expect(copiedJson.debug.provider).toBe("local_llama");

    vi.unstubAllGlobals();
  });

  it("renders debug accordion with fallback when debug settings are enabled", () => {
    useDebugSettingsStore.setState({ showPromptDebug: true, showReasoningDebug: true });

    render(
      <ChatBubble
        message={{
          role: "assistant",
          content: "Historical message without debug",
        }}
      />
    );

    expect(screen.getByText("Historical message without debug")).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy debug/i })).toBeTruthy();
    expect(screen.getByText("Provider")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();

    useDebugSettingsStore.setState({ showPromptDebug: false, showReasoningDebug: false });
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
});
