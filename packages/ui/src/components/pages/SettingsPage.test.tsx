// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.js";
import { useConnectionStore } from "../../stores/connectionStore.js";

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  getConfigService: () => ({
    health: vi.fn().mockResolvedValue({ status: "ok" }),
    getConfig: vi.fn().mockResolvedValue({}),
    getStatus: vi.fn().mockResolvedValue({}),
  }),
  reinitServices: vi.fn(),
  setServiceAccessContext: vi.fn(),
}));

beforeEach(() => {
  useConnectionStore.setState({
    url: "http://localhost:18790",
    status: "disconnected",
  });
});

afterEach(() => {
  cleanup();
});

describe("SettingsPage", () => {
  it("renders standalone token input when managedAccess is false or omitted", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.getByPlaceholderText(/Bearer token/i)).toBeDefined();
    expect(screen.getByText(/Token is preserved locally/i)).toBeDefined();
    expect(screen.getByText("Debug Surfaces")).toBeDefined();
  });

  it("forwards managedAccess to ConnectionStatus when true", () => {
    render(<SettingsPage managedAccess={true} />);

    expect(screen.getByText("Settings")).toBeDefined();
    expect(screen.queryByPlaceholderText(/Bearer token/i)).toBeNull();
    expect(screen.getByText("Authentication is managed by the host application.")).toBeDefined();
  });
});
