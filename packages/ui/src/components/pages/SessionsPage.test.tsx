// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionsListResponse } from "@eigen-air-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useChatStore } from "../../stores/chatStore.js";
import { SessionsPage } from "./SessionsPage.js";

const mockNavigate = vi.fn();
const mockSessionService = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getServiceAccessContext: () => ({ accessRevision: 1 }),
  registerAccessInvalidationListener: () => () => undefined,
  getSessionService: () => mockSessionService,
}));
vi.mock("../../embed/base-path-navigation.js", () => ({
  useBasePathNavigation: () => ({ navigate: mockNavigate }),
}));

function makeSession(id: string, title?: string): Session {
  return {
    id,
    title: title ?? `Session ${id}`,
    channel: "web",
    status: "active",
    started_at: 1000,
    updated_at: 1000,
  };
}

beforeEach(() => {
  useConnectionStore.setState({ sessionId: "sess-active", status: "connected", url: "http://daemon" });
  useChatStore.setState({ messages: [] });
  mockSessionService.listSessions.mockReset();
  mockSessionService.getSession.mockReset();
  mockSessionService.createSession.mockReset();
  mockSessionService.deleteSession.mockReset();
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionsPage cursor pagination and lifecycle", () => {
  it("renders first page of sessions on mount and shows Load more button when cursor present", async () => {
    mockSessionService.listSessions.mockResolvedValueOnce({
      sessions: [makeSession("s-1"), makeSession("s-2")],
      next_cursor: "cursor-page-2",
    } satisfies SessionsListResponse);

    render(<SessionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Session s-1")).toBeTruthy();
      expect(screen.getByText("Session s-2")).toBeTruthy();
    });

    expect(mockSessionService.listSessions).toHaveBeenCalledWith({ limit: 50 });
    const loadMoreBtn = screen.getByRole("button", { name: "Load more sessions" });
    expect(loadMoreBtn).toBeTruthy();
    expect(loadMoreBtn.hasAttribute("disabled")).toBe(false);
  });

  it("appends next page on Load more and deduplicates duplicate ids", async () => {
    mockSessionService.listSessions
      .mockResolvedValueOnce({
        sessions: [makeSession("s-1"), makeSession("s-2")],
        next_cursor: "cursor-2",
      } satisfies SessionsListResponse)
      .mockResolvedValueOnce({
        sessions: [makeSession("s-2"), makeSession("s-3")],
        next_cursor: null,
      } satisfies SessionsListResponse);

    const user = userEvent.setup();
    render(<SessionsPage />);

    await screen.findByText("Session s-1");
    const loadMoreBtn = screen.getByRole("button", { name: "Load more sessions" });
    await user.click(loadMoreBtn);

    await screen.findByText("Session s-3");
    expect(mockSessionService.listSessions).toHaveBeenLastCalledWith({ limit: 50, cursor: "cursor-2" });

    // Session s-2 was duplicated in page 2; verify only one element for s-2
    expect(screen.getAllByTestId("session-s-2").length).toBe(1);
    // Button should disappear because next_cursor is null
    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });

  it("hides Load more button when next_cursor is null on initial load", async () => {
    mockSessionService.listSessions.mockResolvedValueOnce({
      sessions: [makeSession("s-alone")],
      next_cursor: null,
    } satisfies SessionsListResponse);

    render(<SessionsPage />);
    await screen.findByText("Session s-alone");

    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });

  it("resets pagination to first page when Refresh is clicked", async () => {
    mockSessionService.listSessions
      .mockResolvedValueOnce({
        sessions: [makeSession("s-1")],
        next_cursor: "cursor-1",
      } satisfies SessionsListResponse)
      .mockResolvedValueOnce({
        sessions: [makeSession("s-refreshed")],
        next_cursor: null,
      } satisfies SessionsListResponse);

    const user = userEvent.setup();
    render(<SessionsPage />);

    await screen.findByText("Session s-1");
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("Session s-refreshed");
    expect(screen.queryByText("Session s-1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });

  it("ignores responses from superseded generations", async () => {
    let resolveFirst!: (value: SessionsListResponse) => void;
    const firstPromise = new Promise<SessionsListResponse>((resolve) => {
      resolveFirst = resolve;
    });

    mockSessionService.listSessions
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({
        sessions: [makeSession("s-new-gen")],
        next_cursor: null,
      } satisfies SessionsListResponse);
    const user = userEvent.setup();
    render(<SessionsPage />);

    // Click refresh immediately while first load is pending
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    // Second generation completes first
    await screen.findByText("Session s-new-gen");

    // Now resolve first generation response late
    resolveFirst({
      sessions: [makeSession("s-stale-gen")],
      next_cursor: "stale-cursor",
    });

    // Let any pending microtasks flush
    await new Promise((r) => setTimeout(r, 20));

    // Stale generation must not overwrite
    expect(screen.queryByText("Session s-stale-gen")).toBeNull();
    expect(screen.getByText("Session s-new-gen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });

  it("deleting active session creates a replacement then reloads first page", async () => {
    useConnectionStore.setState({ sessionId: "s-active-to-delete" });

    mockSessionService.listSessions
      .mockResolvedValueOnce({
        sessions: [makeSession("s-active-to-delete"), makeSession("s-other")],
        next_cursor: null,
      } satisfies SessionsListResponse)
      .mockResolvedValueOnce({
        sessions: [makeSession("s-replacement"), makeSession("s-other")],
        next_cursor: null,
      } satisfies SessionsListResponse);

    mockSessionService.deleteSession.mockResolvedValueOnce(true);
    mockSessionService.createSession.mockResolvedValueOnce(makeSession("s-replacement"));

    const user = userEvent.setup();
    render(<SessionsPage />);

    await screen.findByText("Session s-active-to-delete");

    const sessionCard = screen.getByTestId("session-s-active-to-delete");
    const deleteBtn = within(sessionCard).getByRole("button", { name: "Delete" });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith("s-active-to-delete");
      expect(mockSessionService.createSession).toHaveBeenCalled();
      expect(useConnectionStore.getState().sessionId).toBe("s-replacement");
    });

    await screen.findByText("Session s-replacement");
    expect(screen.queryByText("Session s-active-to-delete")).toBeNull();
  });

  it("retains existing sessions and cursor on load-more error so user can retry", async () => {
    mockSessionService.listSessions
      .mockResolvedValueOnce({
        sessions: [makeSession("s-1")],
        next_cursor: "cursor-retry",
      } satisfies SessionsListResponse)
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({
        sessions: [makeSession("s-2")],
        next_cursor: null,
      } satisfies SessionsListResponse);

    const user = userEvent.setup();
    render(<SessionsPage />);

    await screen.findByText("Session s-1");
    const loadMoreBtn = screen.getByRole("button", { name: "Load more sessions" });
    await user.click(loadMoreBtn);

    // Error displayed, but s-1 is kept and Load more is still available
    await screen.findByText("Error: network blip");
    expect(screen.getByText("Session s-1")).toBeTruthy();

    // Retry
    await user.click(loadMoreBtn);
    await screen.findByText("Session s-2");
    expect(screen.getByText("Session s-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more sessions" })).toBeNull();
  });
});
