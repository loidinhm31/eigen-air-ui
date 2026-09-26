// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";

vi.mock("../organisms/ChatPanel.js", () => ({
  ChatPanel: () => React.createElement("div", { "data-testid": "chat-panel" }, "ChatPanelMock"),
}));

const mockGetReadiness = vi.fn();

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getConfigService: () => ({
    getReadiness: mockGetReadiness,
  }),
}));

describe("ChatPage readiness polling lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      url: "http://localhost:18790",
      status: "disconnected",
    });
    useReadinessStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useReadinessStore.getState().reset();
  });

  it("starts polling when connection status is connected", () => {
    const startPollingSpy = vi.spyOn(useReadinessStore.getState(), "startPolling");
    useConnectionStore.setState({
      url: "http://localhost:18790",
      status: "connected",
    });

    render(<ChatPage />);

    expect(startPollingSpy).toHaveBeenCalledTimes(1);
    expect(useReadinessStore.getState().phase).toBe("checking");
  });

  it("stops and resets polling when connection status is disconnected", () => {
    const stopPollingSpy = vi.spyOn(useReadinessStore.getState(), "stopPolling");
    const resetSpy = vi.spyOn(useReadinessStore.getState(), "reset");

    useConnectionStore.setState({
      url: "http://localhost:18790",
      status: "disconnected",
    });

    render(<ChatPage />);

    expect(stopPollingSpy).toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalled();
    expect(useReadinessStore.getState().phase).toBe("idle");
  });

  it("cleans up polling on unmount", () => {
    const stopPollingSpy = vi.spyOn(useReadinessStore.getState(), "stopPolling");
    const resetSpy = vi.spyOn(useReadinessStore.getState(), "reset");

    useConnectionStore.setState({
      url: "http://localhost:18790",
      status: "connected",
    });

    const { unmount } = render(<ChatPage />);
    unmount();

    expect(stopPollingSpy).toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalled();
  });
});
