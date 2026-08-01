// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto, RunSummaryDto } from "@nonclaw-ui/shared/types";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useRunInspectorStore } from "../../stores/runInspectorStore.js";
import { RunsPage } from "./RunsPage.js";

const service = vi.hoisted(() => ({
  runCallback: undefined as ((frame: Record<string, unknown>) => void) | undefined,
}));

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getChatService: () => ({
    subscribeRunCorrelation: (callback: (frame: Record<string, unknown>) => void) => {
      service.runCallback = callback;
      return () => {
        service.runCallback = undefined;
      };
    },
    onRunReconnect: () => () => undefined,
  }),
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
});
