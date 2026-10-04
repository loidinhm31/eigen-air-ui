// @vitest-environment jsdom
import * as React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto, RunSummaryDto } from "@eigen-air-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useRunInspectorStore } from "../../stores/runInspectorStore.js";
import { RunsPage } from "./RunsPage.js";
import { SessionsPage } from "./SessionsPage.js";
import { BasePathContext } from "../../embed/base-path-navigation.js";

const service = vi.hoisted(() => ({
  runCallback: undefined as ((frame: Record<string, unknown>) => void) | undefined,
  progressCallback: undefined as ((frame: Record<string, unknown>) => void) | undefined,
  listSessions: vi.fn(),
}));

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    subscribeRunCorrelation: (callback: (frame: Record<string, unknown>) => void) => {
      service.runCallback = callback;
      return () => {
        service.runCallback = undefined;
      };
    },
    subscribeTaskProgress: (callback: (frame: Record<string, unknown>) => void) => {
      service.progressCallback = callback;
      return () => {
        service.progressCallback = undefined;
      };
    },
    onRunReconnect: () => () => undefined,
  }),
  getServiceAccessContext: () => ({}),
  registerAccessInvalidationListener: () => () => {},
  getSessionService: () => ({ listSessions: service.listSessions }),
}));

function runSummary(): RunSummaryDto {
  return {
    run_id: "run-a",
    trace_id: "trace-a",
    session_id: "session-a",
    root_run_id: "run-a",
    tenant_id: "tenant-a",
    user_id: "user-a",
    workspace_id: "workspace-a",
    agent_id: "agent-a",
    provider_id: "provider-a",
    channel: "web",
    lifecycle_status: "running",
    started_at_ms: 1,
    updated_at_ms: 1,
    snapshot_seq: 1,
    correlation_state: "correlated",
    redaction: { metadata_only: true, debug_requested: false, debug_available: false },
  };
}

function snapshot(debug = false): RunSnapshotDto {
  return {
    schema_version: 1,
    run: runSummary(),
    events: [],
    tool_calls: [],
    memory_lineage: [],
    ...(debug
      ? {
          debug_excerpts: [
            {
              excerpt_seq: 1,
              kind: "provider_reasoning" as const,
              plaintext: "secret",
              created_at_ms: 1,
              expires_at_ms: 10_000,
              plaintext_bytes: 6,
              truncated: false,
              redaction_count: 0,
            },
          ],
        }
      : {}),
  };
}

const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  useRunInspectorStore.getState().clear();
  useConnectionStore.setState({ url: "http://daemon" });
  service.listSessions.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RunsPage lifecycle reconciliation", () => {
  it("rejects a sensitive detail response that resolves after unmount", async () => {
    let resolveDetail!: (value: Response) => void;
    const detail = new Promise<Response>((resolve) => {
      resolveDetail = resolve;
    });
    const fetch = vi.fn((url: string) =>
      Promise.resolve(url.includes("?limit=") ? response({ schema_version: 1, runs: [runSummary()] }) : detail)
    );
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    const view = render(<RunsPage access={{ identityKey: "user-a" }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    view.unmount();

    await act(async () => {
      resolveDetail(response(snapshot(true)));
      await detail;
    });
    expect(useRunInspectorStore.getState().snapshots).toEqual({});
  });

  it("refetches the selected snapshot for an explicit uncorrelated recovery signal", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        response(url.includes("?limit=") ? { schema_version: 1, runs: [runSummary()] } : snapshot())
      )
    );
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a" }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter((c) => (c[0] as string).includes("/v1/runs/run-a"))
      ).toHaveLength(1)
    );

    act(() => {
      service.runCallback?.({
        event: "run.delta",
        snapshot_refetch_required: true,
      });
    });
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter((c) => (c[0] as string).includes("/v1/runs/run-a"))
      ).toHaveLength(2)
    );
  });

  it("keeps a run visible while DELETE is pending, then evicts only after success", async () => {
    let resolveDelete!: (value: Response) => void;
    const deleting = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("?limit=")) return Promise.resolve(response({ schema_version: 1, runs: [runSummary()] }));
      if (init?.method === "DELETE") return deleting;
      return Promise.resolve(response(snapshot()));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:delete"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("status").textContent).toMatch(/Deleting/);
    expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeDefined();

    await act(async () => {
      resolveDelete({ ok: true, status: 204 } as Response);
      await deleting;
    });
    await waitFor(() => expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeUndefined());
    expect(screen.getByText("Run deleted.")).toBeDefined();
  });

  it("retains the run and exposes an error when DELETE fails", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("?limit=")) return Promise.resolve(response({ schema_version: 1, runs: [runSummary()] }));
      if (init?.method === "DELETE") return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: "Nope" }) });
      return Promise.resolve(response(snapshot()));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:delete"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Nope"));
    expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeDefined();
  });

  it("clears cached plaintext when DELETE returns a no-oracle 404", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("?limit=")) return Promise.resolve(response({ schema_version: 1, runs: [runSummary()] }));
      if (init?.method === "DELETE")
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      return Promise.resolve(response(snapshot(true)));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:delete"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await waitFor(() => expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeDefined());
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Run unavailable."));
    expect(useRunInspectorStore.getState().snapshots).toEqual({});
    act(() => {
      service.runCallback?.({
        event: "run.delta",
        run_id: "run-a",
        event_id: "late-event",
        event_seq: 2,
        occurred_at_ms: 2,
      });
    });
    expect(useRunInspectorStore.getState().pending).toEqual({});
  });

  it("searches exact server history, fences stale pagination and clears selected evidence across sessions", async () => {
    let resolvePage!: (value: Response) => void;
    const latePage = new Promise<Response>((resolve) => { resolvePage = resolve; });
    let pageSignal: AbortSignal | undefined;
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      const request = new URL(url);
      if (request.searchParams.has("cursor")) {
        pageSignal = init?.signal as AbortSignal;
        return latePage;
      }
      if (request.pathname === "/v1/runs") {
        return Promise.resolve(response({
          schema_version: 1,
          runs: request.searchParams.get("session_id") === "session-a" ? [runSummary()] : [],
          next_cursor: request.searchParams.get("session_id") === "session-a" ? "next-a" : null,
        }));
      }
      return Promise.resolve(response(snapshot()));
    });
    vi.stubGlobal("fetch", fetch);
    function Location() { return <output aria-label="Current URL">{useLocation().search}</output>; }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/runs?session_id=session-a"]}>
        <RunsPage /><Location />
      </MemoryRouter>
    );
    expect(screen.getByRole("textbox", { name: "Session ID" })).toHaveProperty("value", "session-a");
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await screen.findByRole("article", { name: "Run run-a" });
    await user.click(screen.getByRole("button", { name: "Load more runs" }));
    await user.clear(screen.getByRole("textbox", { name: "Session ID" }));
    await user.type(screen.getByRole("textbox", { name: "Session ID" }), "session/other +");
    await user.click(screen.getByRole("button", { name: "Search session" }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) =>
      new URL(url).searchParams.get("session_id") === "session/other +"
    )).toBe(true));
    expect(pageSignal?.aborted).toBe(true);
    expect(useRunInspectorStore.getState().snapshots).toEqual({});
    expect(screen.getByLabelText("Current URL").textContent).not.toContain("run_id");
    await act(async () => {
      resolvePage(response({ schema_version: 1, runs: [{ ...runSummary(), run_id: "late-a" }] }));
      await latePage;
    });
    expect(screen.queryByRole("button", { name: "late-a" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear session filter" }));
    await waitFor(() => expect(screen.getByLabelText("Current URL").textContent).toBe(""));
    expect(screen.getByRole("textbox", { name: "Session ID" })).toHaveProperty("value", "");
    expect(new URL(fetch.mock.calls.at(-1)![0]).searchParams.has("session_id")).toBe(false);
  });

  it("opens session runs under the embed base path without switching the active chat session", async () => {
    service.listSessions.mockResolvedValue([{ id: "session/a +", title: "Archived session", channel: "web", status: "active", updated_at: 1 }]);
    useConnectionStore.setState({ sessionId: "active-chat" });
    const fetch = vi.fn().mockResolvedValue(response({ schema_version: 1, runs: [] }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/embed/sessions"]}>
        <BasePathContext.Provider value="/embed">
          <Routes>
            <Route path="/embed/sessions" element={<SessionsPage />} />
            <Route path="/embed/runs" element={<RunsPage />} />
          </Routes>
        </BasePathContext.Provider>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole("button", { name: "View runs for session session/a +" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Session ID" })).toHaveProperty("value", "session/a +"));
    expect(useConnectionStore.getState().sessionId).toBe("active-chat");
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("session_id")).toBe("session/a +");
  });

  it("fetches selected run directly from run_id query parameter even when absent from list", async () => {
    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/runs/direct-run")) {
        return Promise.resolve(
          response({ ...snapshot(false), run: { ...runSummary(), run_id: "direct-run" } })
        );
      }
      return Promise.resolve(response({ schema_version: 1, runs: [], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <MemoryRouter initialEntries={["/runs?run_id=direct-run"]}>
        <RunsPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/runs/direct-run"),
        expect.anything()
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Run direct-run/ })).toBeDefined();
    });
  });

  it("paginates runs list when Load more runs is clicked", async () => {
    const fetch = vi.fn((url: string) => {
      if (url.includes("cursor=page-2-cursor")) {
        return Promise.resolve(
          response({
            schema_version: 1,
            runs: [{ ...runSummary(), run_id: "run-b" }],
            next_cursor: null,
          })
        );
      }
      return Promise.resolve(
        response({
          schema_version: 1,
          runs: [runSummary()],
          next_cursor: "page-2-cursor",
        })
      );
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage />);
    const loadMoreButton = await screen.findByRole("button", { name: "Load more runs" });
    await user.click(loadMoreButton);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("cursor=page-2-cursor"),
        expect.anything()
      );
    });
    expect(await screen.findByRole("button", { name: "run-b" })).toBeDefined();
    expect(screen.getByRole("button", { name: "run-a" })).toBeDefined();
  });


  it("loads run tree for delegated run and navigates to child and parent runs", async () => {
    const parentRunSummary: RunSummaryDto = {
      ...runSummary(),
      run_id: "run-parent",
      root_run_id: "run-parent",
    };
    const parentSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run: parentRunSummary,
      task_progress: {
        artifact_type: "task_progress",
        schema_version: 1,
        artifact_id: "art-parent",
        root_session_id: "sess-root",
        task_id: "task-parent",
        subagent_run_id: "run-parent",
        run_id: "run-parent",
        trace_id: "trace-p",
        parent_run_id: null,
        root_run_id: "run-parent",
        projection_status: "running",
        verification_status: "unverified",
        artifact_revision: 2,
        artifact_event_seq: 4,
        g2_snapshot_seq: 5,
        claimed_active_count: 1,
        claimed_item_count: 2,
        updated_at_ms: 1000,
        terminal_at_ms: null,
        redaction: { metadata_only: true, hidden_fields: [] },
      },
    };
    const childSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run: {
        ...runSummary(),
        run_id: "run-child",
        parent_run_id: "run-parent",
        root_run_id: "run-parent",
      },
      task_progress: {
        artifact_type: "task_progress",
        schema_version: 1,
        artifact_id: "art-child",
        root_session_id: "sess-root",
        task_id: "task-child",
        subagent_run_id: "run-child",
        run_id: "run-child",
        trace_id: "trace-c",
        parent_run_id: "run-parent",
        root_run_id: "run-parent",
        projection_status: "succeeded",
        verification_status: "verified_success",
        artifact_revision: 3,
        artifact_event_seq: 6,
        g2_snapshot_seq: 8,
        claimed_active_count: 0,
        claimed_item_count: 1,
        updated_at_ms: 2000,
        terminal_at_ms: 2000,
        redaction: { metadata_only: true, hidden_fields: [] },
      },
    };

    const treeNodes = [
      {
        id: "tree-node-1",
        root_session_id: "sess-root",
        parent_session_id: "sess-root",
        child_session_id: "sess-child",
        parent_run_id: "run-parent",
        child_run_id: "run-child",
        root_run_id: "run-parent",
        delegated_task_id: "task-child",
        source_agent_id: "lead",
        target_agent_id: "worker",
        depth: 1,
        created_at: 100,
      },
    ];

    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/run-trees/sess-root")) {
        return Promise.resolve(response(treeNodes));
      }
      if (url.includes("/v1/runs/run-child")) {
        return Promise.resolve(response(childSnapshot));
      }
      if (url.includes("/v1/runs/run-parent")) {
        return Promise.resolve(response(parentSnapshot));
      }
      return Promise.resolve(response({ schema_version: 1, runs: [parentRunSummary], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );

    // Open parent run
    await user.click(await screen.findByRole("button", { name: "run-parent" }));
    expect(await screen.findByTestId("projection-status")).toBeDefined();
    expect(screen.getByTestId("projection-status").textContent).toBe("Running");

    // Check that run tree was fetched and child run link is displayed
    const childLink = await screen.findByRole("button", { name: "Navigate to child run run-child" });
    expect(childLink).toBeDefined();

    // Click child run link to navigate
    await user.click(childLink);
    await waitFor(() => {
      expect(screen.getByTestId("projection-status").textContent).toBe("Succeeded (terminal)");
    });
    expect(screen.getByTestId("verification-status").textContent).toBe("Verified success (lifecycle only)");

    // In child view, parent link is available
    const parentLink = screen.getByRole("button", { name: "Navigate to parent run run-parent" });
    await user.click(parentLink);
    await waitFor(() => {
      expect(screen.getByTestId("projection-status").textContent).toBe("Running");
    });
  });
  it("loads run tree when inspecting a root run whose task_progress is null", async () => {
    const rootRunSummary: RunSummaryDto = {
      ...runSummary(),
      run_id: "run-root-notask",
      session_id: "sess-root-notask",
      parent_run_id: null,
      root_run_id: "run-root-notask",
    };
    const rootSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run: rootRunSummary,
      task_progress: null,
    };
    const treeNodes = [
      {
        id: "tree-node-1",
        root_session_id: "sess-root-notask",
        parent_session_id: "sess-root-notask",
        child_session_id: "sess-child-1",
        parent_run_id: "run-root-notask",
        child_run_id: "run-child-1",
        root_run_id: "run-root-notask",
        delegated_task_id: "task-child-1",
        source_agent_id: "lead",
        target_agent_id: "worker",
        depth: 1,
        created_at: 100,
      },
    ];

    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/run-trees/sess-root-notask")) {
        return Promise.resolve(response(treeNodes));
      }
      if (url.includes("/v1/runs/run-root-notask")) {
        return Promise.resolve(response(rootSnapshot));
      }
      return Promise.resolve(response({ schema_version: 1, runs: [rootRunSummary], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "run-root-notask" }));
    const childLink = await screen.findByRole("button", { name: "Navigate to child run run-child-1" });
    expect(childLink).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/run-trees/sess-root-notask"),
      expect.anything()
    );
  });
  it("loads run tree for child run without task_progress by resolving root run snapshot", async () => {
    const childRunSummary: RunSummaryDto = {
      ...runSummary(),
      run_id: "run-child-notask",
      session_id: "sess-child-notask",
      parent_run_id: "run-root-async",
      root_run_id: "run-root-async",
    };
    const childSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run: childRunSummary,
      task_progress: null,
    };
    const rootSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run: {
        ...runSummary(),
        run_id: "run-root-async",
        session_id: "sess-root-async",
        parent_run_id: null,
        root_run_id: "run-root-async",
      },
      task_progress: null,
    };
    const treeNodes = [
      {
        id: "tree-node-1",
        root_session_id: "sess-root-async",
        parent_session_id: "sess-root-async",
        child_session_id: "sess-child-notask",
        parent_run_id: "run-root-async",
        child_run_id: "run-child-notask",
        root_run_id: "run-root-async",
        delegated_task_id: "task-child-1",
        source_agent_id: "lead",
        target_agent_id: "worker",
        depth: 1,
        created_at: 100,
      },
    ];

    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/run-trees/sess-root-async")) {
        return Promise.resolve(response(treeNodes));
      }
      if (url.includes("/v1/runs/run-child-notask")) {
        return Promise.resolve(response(childSnapshot));
      }
      if (url.includes("/v1/runs/run-root-async")) {
        return Promise.resolve(response(rootSnapshot));
      }
      return Promise.resolve(response({ schema_version: 1, runs: [childRunSummary], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "run-child-notask" }));
    const parentLink = await screen.findByRole("button", { name: "Navigate to parent run run-root-async" });
    expect(parentLink).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/runs/run-root-async"),
      expect.anything()
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/run-trees/sess-root-async"),
      expect.anything()
    );
  });


  it("updates task progress via live WebSocket event and reconciles on gap", async () => {
    const run = { ...runSummary(), run_id: "run-live" };
    const initialSnapshot: RunSnapshotDto = {
      ...snapshot(false),
      run,
      task_progress: {
        artifact_type: "task_progress",
        schema_version: 1,
        artifact_id: "art-live",
        root_session_id: "sess-live",
        task_id: "task-live",
        subagent_run_id: "run-live",
        run_id: "run-live",
        trace_id: "trace-l",
        parent_run_id: null,
        root_run_id: "run-live",
        projection_status: "running",
        verification_status: "unverified",
        artifact_revision: 1,
        artifact_event_seq: 1,
        g2_snapshot_seq: 1,
        claimed_active_count: 1,
        claimed_item_count: 1,
        updated_at_ms: 1000,
        terminal_at_ms: null,
        redaction: { metadata_only: true, hidden_fields: [] },
      },
    };

    let fetchCount = 0;
    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/run-trees/sess-live")) {
        return Promise.resolve(response([]));
      }
      if (url.includes("/v1/runs/run-live")) {
        fetchCount += 1;
        return Promise.resolve(response(initialSnapshot));
      }
      return Promise.resolve(response({ schema_version: 1, runs: [run], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "run-live" }));
    expect(await screen.findByText("rev 1")).toBeDefined();

    // 1. Contiguous live WS progress event: revision 2
    act(() => {
      service.progressCallback?.({
        type: "event",
        version: "v1",
        event: "task_progress.updated",
        run_id: "run-live",
        payload: {
          artifact_id: "art-live",
          task_id: "task-live",
          subagent_run_id: "run-live",
          artifact_revision: 2,
          artifact_event_seq: 2,
          snapshot_seq: 2,
          projection_status: "running",
          verification_status: "unverified",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("rev 2")).toBeDefined();
    });

    // 2. Sequence gap: revision jumps to 5 -> triggers REST snapshot reconciliation
    const beforeRefetchCount = fetchCount;
    act(() => {
      service.progressCallback?.({
        type: "event",
        version: "v1",
        event: "task_progress.updated",
        run_id: "run-live",
        payload: {
          artifact_id: "art-live",
          task_id: "task-live",
          subagent_run_id: "run-live",
          artifact_revision: 5,
          artifact_event_seq: 5,
          snapshot_seq: 5,
          projection_status: "running",
          verification_status: "unverified",
        },
      });
    });

    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(beforeRefetchCount);
    });
  });

  it("fetches historical tool approvals when a run is opened and displays them in inspector", async () => {
    const sampleApproval = {
      approval_id: "app-page-1",
      schema_version: "tool_approval.v1",
      tenant_id: "tenant-a",
      user_id: "user-a",
      workspace_id: "workspace-a",
      session_id: "session-a",
      run_id: "run-a",
      tool_call_id: "call-1",
      ordinal: 0,
      tool_name: "shell",
      operation: "execute",
      risk: "high",
      state: "approved_once",
      safe_summary: {
        program: "uptime",
        args_count: 0,
        working_dir: "workspace_root",
      },
      binding_digest: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
      revision: 1,
      created_at_ms: 1000,
      expires_at_ms: 2000,
      terminal_at_ms: null,
      terminal_code: null,
      decision_by_credential_id: "cred-admin",
      redaction: "metadata_only",
    };

    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/tool-approvals")) {
        return Promise.resolve(
          response({
            schema_version: "tool_approval.v1",
            approvals: [sampleApproval],
            redaction: "metadata_only",
          })
        );
      }
      if (url.includes("?limit=")) {
        return Promise.resolve(response({ schema_version: 1, runs: [runSummary()] }));
      }
      return Promise.resolve(response(snapshot()));
    });
    vi.stubGlobal("fetch", fetch);

    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a" }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));

    await waitFor(() => {
      expect(
        fetch.mock.calls.some((c) => (c[0] as string).includes("/v1/tool-approvals"))
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByText("shell.execute")).toBeDefined();
      expect(screen.getByText(/approval app-page-1/)).toBeDefined();
    });
  });

  it("clears cached run evidence on continuation 403 authorization denial", async () => {
    let callCount = 0;
    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/runs/run-a")) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            response({
              ...snapshot(false),
              next_event_cursor: "page-2-cursor",
            })
          );
        }
        // Second call (continuation) denied with 403
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "permission_denied" } }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(response({ schema_version: 1, runs: [runSummary()], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));

    // Initial snapshot loaded
    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Run run-a/ })).toBeDefined();
    });

    // Click Load more events to trigger continuation
    const loadMoreBtn = await screen.findByRole("button", { name: /Load more events/i });
    await user.click(loadMoreBtn);

    // After 403 denial, previous run snapshot must be cleared via clearUnavailable("denied")
    await waitFor(() => {
      expect(useRunInspectorStore.getState().status).toBe("denied");
      expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeUndefined();
    });
  });

  it("retains cached run evidence on continuation 503 unavailable error", async () => {
    let callCount = 0;
    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/runs/run-a")) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            response({
              ...snapshot(false),
              next_event_cursor: "page-2-cursor",
            })
          );
        }
        // Second call (continuation) fails with 503 Service Unavailable
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "run_unavailable" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(response({ schema_version: 1, runs: [runSummary()], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));

    await waitFor(() => {
      expect(screen.getByRole("article", { name: /Run run-a/ })).toBeDefined();
    });

    const loadMoreBtn = await screen.findByRole("button", { name: /Load more events/i });
    await user.click(loadMoreBtn);

    // After 503, evidence must be RETAINED for retry
    await waitFor(() => {
      expect(useRunInspectorStore.getState().snapshots["run-a"]).toBeDefined();
      expect(useRunInspectorStore.getState().streams?.events.error).toBeDefined();
    });
  });

  it.each([401, 403, 404, "network", "success"] as const)(
    "keeps run B intact and exportable after abandoned run A export settles with %s",
    async (outcome) => {
      let resolveExport!: (value: Response) => void;
      let rejectExport!: (reason: Error) => void;
      const pendingExport = new Promise<Response>((resolve, reject) => {
        resolveExport = resolve;
        rejectExport = reject;
      });
      let exportSignal: AbortSignal | undefined;
      const runB = { ...runSummary(), run_id: "run-b", root_run_id: "run-b" };
      const snapshotB = { ...snapshot(), run: runB };
      const fetch = vi.fn((url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === "/v1/runs/run-a/export") {
          exportSignal = init?.signal as AbortSignal;
          return pendingExport;
        }
        if (path === "/v1/runs/run-b/export")
          return Promise.resolve(new Response("run B export"));
        if (path === "/v1/runs")
          return Promise.resolve(response({ schema_version: 1, runs: [runSummary(), runB] }));
        return Promise.resolve(response(path === "/v1/runs/run-b" ? snapshotB : snapshot()));
      });
      vi.stubGlobal("fetch", fetch);
      const createObjectURL = vi.fn().mockReturnValue("blob:run-b");
      const revokeObjectURL = vi.fn();
      const OriginalURL = globalThis.URL;
      class DownloadURL extends OriginalURL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      }
      vi.stubGlobal("URL", DownloadURL);
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={["/runs"]}>
          <BasePathContext.Provider value="">
            <RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:export"]) }} />
          </BasePathContext.Provider>
        </MemoryRouter>
      );
      await user.click(await screen.findByRole("button", { name: "run-a" }));
      await user.click(await screen.findByRole("button", { name: "Export JSON" }));
      expect(screen.getByText("Exporting run…")).toBeDefined();
      await user.click(screen.getByRole("button", { name: "run-b" }));
      await screen.findByRole("article", { name: "Run run-b" });
      expect(exportSignal?.aborted).toBe(true);
      expect(screen.getByRole("button", { name: "Export JSON" })).toHaveProperty("disabled", false);
      const selectedB = useRunInspectorStore.getState().snapshots["run-b"];

      // The transport deliberately ignores cancellation to exercise stale completion handling.
      await act(async () => {
        if (outcome === "success") resolveExport(new Response("private run A export"));
        else if (outcome === "network") rejectExport(new Error("Old run network failure"));
        else resolveExport(new Response(JSON.stringify({ message: "Old run unavailable" }), { status: outcome }));
        await pendingExport.catch(() => undefined);
      });
      const state = useRunInspectorStore.getState();
      expect(state.selectedRunId).toBe("run-b");
      expect(state.snapshots["run-b"]).toBe(selectedB);
      expect(state.operation).toBeUndefined();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("article", { name: "Run run-b" })).toBeDefined();
      expect(screen.getByRole("button", { name: "run-b" })).toBeDefined();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Export JSON" }));
      await screen.findByText("Run exported.");
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click.mock.instances[0]).toHaveProperty("download", "run-b.json");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:run-b");
      expect(useRunInspectorStore.getState().operation).toEqual({
        kind: "export", runId: "run-b", status: "success",
      });
    }
  );

  it.each([401, 403, 404, "network"] as const)(
    "still handles the current selected run export error %s",
    async (outcome) => {
      const fetch = vi.fn((url: string) => {
        if (url.includes("/export")) {
          return outcome === "network"
            ? Promise.reject(new Error("Current export failed"))
            : Promise.resolve(new Response(JSON.stringify({ message: "Unavailable" }), { status: outcome }));
        }
        return Promise.resolve(response(url.includes("?limit=") ? { schema_version: 1, runs: [runSummary()] } : snapshot()));
      });
      vi.stubGlobal("fetch", fetch);
      const user = userEvent.setup();
      render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:export"]) }} />);
      await user.click(await screen.findByRole("button", { name: "run-a" }));
      await user.click(await screen.findByRole("button", { name: "Export JSON" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        outcome === "network" ? "Current export failed" : "Run unavailable."
      );
      const state = useRunInspectorStore.getState();
      if (outcome === "network") {
        expect(state.selectedRunId).toBe("run-a");
        expect(state.snapshots["run-a"]).toBeDefined();
        expect(state.operation).toEqual({
          kind: "export", runId: "run-a", status: "failed", error: "Current export failed",
        });
        expect(screen.getByRole("button", { name: "Export JSON" })).toHaveProperty("disabled", false);
      } else {
        expect(state.status).toBe(outcome === 404 ? "not-found" : "denied");
        expect(state.snapshots).toEqual({});
        expect(state.selectedRunId).toBeUndefined();
      }
    }
  );

  it("keeps an export pending across same-run debug opt-in and downloads its result", async () => {
    let resolveExport!: (value: Response) => void;
    const pendingExport = new Promise<Response>((resolve) => { resolveExport = resolve; });
    let exportSignal: AbortSignal | undefined;
    const debugSnapshot = snapshot(true);
    debugSnapshot.debug_excerpts = debugSnapshot.debug_excerpts?.map((excerpt) => ({
      ...excerpt, expires_at_ms: Date.now() + 60_000,
    }));
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/export")) {
        exportSignal = init?.signal as AbortSignal;
        return pendingExport;
      }
      return Promise.resolve(response(url.includes("?limit=")
        ? { schema_version: 1, runs: [runSummary()] }
        : url.includes("include_debug=true") ? debugSnapshot : snapshot()));
    });
    vi.stubGlobal("fetch", fetch);
    const createObjectURL = vi.fn().mockReturnValue("blob:run-a");
    const OriginalURL = globalThis.URL;
    class DownloadURL extends OriginalURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:export", "run:read:debug"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await user.click(await screen.findByRole("button", { name: "Export JSON" }));
    await user.click(screen.getByRole("button", { name: "Request debug" }));
    await waitFor(() => expect(useRunInspectorStore.getState().snapshots["run-a"].debug_excerpts?.[0]?.plaintext).toBe("secret"));
    expect(exportSignal?.aborted).toBe(false);
    expect(useRunInspectorStore.getState().operation?.status).toBe("pending");
    await act(async () => {
      resolveExport(new Response("current run A export"));
      await pendingExport;
    });
    await screen.findByText("Run exported.");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0]).toHaveProperty("download", "run-a.json");
  });

  it("does not download text resolved after an identity switch", async () => {
    let resolveExport!: (value: Response) => void;
    const pendingExport = new Promise<Response>((resolve) => { resolveExport = resolve; });
    let exportSignal: AbortSignal | undefined;
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/export?")) {
        exportSignal = init?.signal as AbortSignal;
        return pendingExport;
      }
      return Promise.resolve(response(url.includes("?limit=") ? { schema_version: 1, runs: [runSummary()] } : snapshot()));
    });
    vi.stubGlobal("fetch", fetch);
    const createObjectURL = vi.fn();
    const OriginalURL = globalThis.URL;
    class DownloadURL extends OriginalURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); }
    vi.stubGlobal("URL", DownloadURL);
    const user = userEvent.setup();
    const view = render(<RunsPage access={{ identityKey: "user-a", capabilities: new Set(["run:export", "run:read:debug"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await user.click(await screen.findByRole("button", { name: "Export text" }));
    view.rerender(<RunsPage access={{ identityKey: "user-b", capabilities: new Set(["run:export"]) }} />);
    await act(async () => {
      resolveExport(response({ ...snapshot(), transcript: { messages: [{ role: "assistant", content: "private user-a answer" }], truncated: false } }));
      await pendingExport;
    });
    expect(exportSignal?.aborted).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(useRunInspectorStore.getState().snapshots).toEqual({});
  });
});
