// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NonclawApp } from "./NonclawApp.js";
import { useConnectionStore } from "../stores/connectionStore.js";
import * as ServiceFactory from "../adapters/factory/ServiceFactory.js";

vi.mock("../adapters/factory/ServiceFactory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adapters/factory/ServiceFactory.js")>();
  return {
    ...actual,
    hasReinitFn: () => true, // Avoid autoConnect timer loop in test
    setServiceAccessContext: vi.fn(),
    getConfigService: () => ({
      health: vi.fn().mockResolvedValue({ status: "ok" }),
      getConfig: vi.fn().mockResolvedValue({}),
      getStatus: vi.fn().mockResolvedValue({}),
    }),
    getChatService: () => ({
      connect: vi.fn().mockResolvedValue({ version: "0.1.0", session_id: "s-1" }),
      disconnect: vi.fn(),
      subscribeRunCorrelation: () => () => undefined,
      onRunReconnect: () => () => undefined,
      subscribeUserQuestion: () => () => undefined,
      onQuestionProtocolError: () => () => undefined,
    }),
    getSessionService: () => ({
      createSession: vi.fn().mockResolvedValue({ id: "s-1" }),
    }),
    getSkillService: () => ({
      list: vi.fn().mockResolvedValue([]),
    }),
    getUserQuestionService: () => ({
      list: vi.fn().mockResolvedValue({ questions: [] }),
    }),
    getRunService: () => ({
      get: vi.fn().mockResolvedValue({}),
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  useConnectionStore.setState({
    url: "http://localhost:18790",
    status: "disconnected",
  });
});

afterEach(() => {
  cleanup();
});

describe("NonclawApp", () => {
  it("passes ephemeral runAccess context to ServiceFactory", () => {
    const runAccess = {
      authToken: "embedded-host-token",
      identityKey: "host-user-1",
      capabilities: new Set<"run:read:debug">(["run:read:debug"]),
    };

    render(<NonclawApp runAccess={runAccess} />);

    expect(ServiceFactory.setServiceAccessContext).toHaveBeenCalledWith(runAccess);
  });

  it("does not call setServiceAccessContext in standalone mode, preserving in-memory token across daemonUrl changes", () => {
    const { rerender } = render(<NonclawApp />);

    expect(ServiceFactory.setServiceAccessContext).not.toHaveBeenCalled();

    // Changing daemonUrl should not reset service access context
    useConnectionStore.setState({ url: "http://localhost:19000" });
    rerender(<NonclawApp />);

    expect(ServiceFactory.setServiceAccessContext).not.toHaveBeenCalled();
  });
});
