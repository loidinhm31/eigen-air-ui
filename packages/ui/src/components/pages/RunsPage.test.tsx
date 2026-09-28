// @vitest-environment jsdom
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto, RunSummaryDto } from "@eigen-air-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useRunInspectorStore } from "../../stores/runInspectorStore.js";
import { RunsPage } from "./RunsPage.js";

const service = vi.hoisted(() => ({
  runCallback: undefined as ((frame: Record<string, unknown>) => void) | undefined,
  progressCallback: undefined as ((frame: Record<string, unknown>) => void) | undefined,
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    act(() => {
      service.runCallback?.({
        event: "run.delta",
        snapshot_refetch_required: true,
      });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
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

  it("filters runs list by session_id from URL query and supports clearing filter", async () => {
    const fetch = vi.fn(() => {
      return Promise.resolve(response({ schema_version: 1, runs: [runSummary()], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/runs?session_id=session-test"]}>
        <RunsPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("session_id=session-test"),
        expect.anything()
      );
    });
    expect(screen.getByText("session-test")).toBeDefined();
    const clearButton = screen.getByRole("button", { name: "Clear session filter" });
    await user.click(clearButton);
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

  it("shows partial-export note when cursors remain on the selected run", async () => {
    const fetch = vi.fn((url: string) => {
      if (url.includes("/v1/runs/run-a")) {
        return Promise.resolve(
          response({
            ...snapshot(false),
            next_event_cursor: "more-events",
          })
        );
      }
      return Promise.resolve(response({ schema_version: 1, runs: [runSummary()], next_cursor: null }));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<RunsPage access={{ capabilities: new Set(["run:export"]) }} />);
    await user.click(await screen.findByRole("button", { name: "run-a" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Export includes snapshot page only; additional history remains on server/i)
      ).toBeDefined();
    });
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
});
