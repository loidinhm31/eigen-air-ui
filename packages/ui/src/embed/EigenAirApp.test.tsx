// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EigenAirApp } from "./EigenAirApp.js";
import { useConnectionStore } from "../stores/connectionStore.js";
import * as ServiceFactory from "../adapters/factory/ServiceFactory.js";
import { resetConnectionControllerForTests } from "../adapters/factory/connection-controller.js";

const mockChatService = {
  connect: vi.fn().mockResolvedValue({ version: "0.1.0", session_id: "s-1" }),
  disconnect: vi.fn(),
  subscribeRunCorrelation: () => () => undefined,
  onRunReconnect: () => () => undefined,
  subscribeUserQuestion: () => () => undefined,
  onQuestionProtocolError: () => () => undefined,
};
const mockConfigService = {
  health: vi.fn().mockResolvedValue({ status: "ok" }),
  getConfig: vi.fn().mockResolvedValue({}),
  getStatus: vi.fn().mockResolvedValue({}),
};

vi.mock("../adapters/factory/ServiceFactory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adapters/factory/ServiceFactory.js")>();
  return {
    ...actual,
    hasReinitFn: () => true, // Avoid autoConnect timer loop in test
    setServiceAccessContext: vi.fn(),
    getConfigService: () => mockConfigService,
    getChatService: () => mockChatService,
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
  resetConnectionControllerForTests();
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

describe("EigenAirApp", () => {
  it("passes ephemeral runAccess context to ServiceFactory", () => {
    const runAccess = {
      authToken: "embedded-host-token",
      identityKey: "host-user-1",
      capabilities: new Set<"run:read:debug">(["run:read:debug"]),
    };

    render(<EigenAirApp runAccess={runAccess} />);

    expect(ServiceFactory.setServiceAccessContext).toHaveBeenCalledWith(runAccess);
  });

  it("does not call setServiceAccessContext in standalone mode, preserving in-memory token across daemonUrl changes", () => {
    const { rerender } = render(<EigenAirApp />);

    expect(ServiceFactory.setServiceAccessContext).not.toHaveBeenCalled();

    // Changing daemonUrl should not reset service access context
    useConnectionStore.setState({ url: "http://localhost:19000" });
    rerender(<EigenAirApp />);

    expect(ServiceFactory.setServiceAccessContext).not.toHaveBeenCalled();
  });

  it("starts auto connect and settles connection when appLayerOwnsLifecycle is false", async () => {
    vi.spyOn(ServiceFactory, "hasReinitFn").mockReturnValue(false);
    render(<EigenAirApp />);
    await waitFor(() => {
      expect(useConnectionStore.getState().status).toBe("connected");
      expect(useConnectionStore.getState().sessionId).toBe("s-1");
    });
  });
});
