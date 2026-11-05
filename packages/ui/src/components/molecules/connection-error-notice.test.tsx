// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppShell } from "../templates/AppShell.js";
import {
  ConnectionErrorNotice,
  CONNECTION_ERROR_MESSAGES,
  getConnectionErrorMessage,
} from "./connection-error-notice.js";
import { useConnectionStore } from "../../stores/connectionStore.js";

function renderWithRouter(ui: React.ReactElement, initialEntries = ["/"]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);
}

describe("ConnectionErrorNotice", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      url: "http://localhost:18790",
      status: "disconnected",
      version: undefined,
      sessionId: undefined,
      error: undefined,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when error is undefined", () => {
    useConnectionStore.setState({ error: undefined });
    renderWithRouter(<ConnectionErrorNotice />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing for transient error kinds: timeout and unreachable", () => {
    useConnectionStore.setState({ error: "timeout" });
    const { rerender } = renderWithRouter(<ConnectionErrorNotice />);
    expect(screen.queryByRole("alert")).toBeNull();

    useConnectionStore.setState({ error: "unreachable" });
    rerender(
      <MemoryRouter initialEntries={["/"]}>
        <ConnectionErrorNotice />
      </MemoryRouter>
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders alert and Settings link when error is unauthenticated", () => {
    useConnectionStore.setState({ error: "unauthenticated" });
    renderWithRouter(<ConnectionErrorNotice />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain(
      "Authentication required. Enter the daemon token (config.toml `[server].token`) in Settings."
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("renders alert and Settings link when error is unsupported_daemon", () => {
    useConnectionStore.setState({ error: "unsupported_daemon" });
    renderWithRouter(<ConnectionErrorNotice />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain(
      "This daemon version is not compatible with the UI. Upgrade the daemon."
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("resolves relative Settings NavLink with nested route", () => {
    useConnectionStore.setState({ error: "unauthenticated" });
    render(
      <MemoryRouter basename="/embed" initialEntries={["/embed"]}>
        <ConnectionErrorNotice />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/embed/settings");
  });

  it("navigates to settings when clicking notice link within real route hierarchy", async () => {
    const user = userEvent.setup();
    useConnectionStore.setState({ error: "unauthenticated" });

    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="runs" element={<div data-testid="runs-view">Runs View</div>} />
            <Route path="settings" element={<div data-testid="settings-view">Settings View</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("runs-view")).toBeDefined();
    // Locate the notice alert link specifically
    const alert = screen.getByRole("alert");
    const link = alert.querySelector("a");
    expect(link).toBeDefined();
    expect(link!.textContent).toBe("Settings");
    await user.click(link!);
    expect(screen.getByTestId("settings-view")).toBeDefined();
  });

  it("getConnectionErrorMessage helper returns exact messages and null for other kinds", () => {
    expect(getConnectionErrorMessage("unauthenticated")).toBe(
      CONNECTION_ERROR_MESSAGES.unauthenticated
    );
    expect(getConnectionErrorMessage("unsupported_daemon")).toBe(
      CONNECTION_ERROR_MESSAGES.unsupported_daemon
    );
    expect(getConnectionErrorMessage("timeout")).toBeNull();
    expect(getConnectionErrorMessage("unreachable")).toBeNull();
    expect(getConnectionErrorMessage(undefined)).toBeNull();
  });
});
