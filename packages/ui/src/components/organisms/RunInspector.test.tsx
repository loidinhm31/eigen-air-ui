// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto } from "@eigen-air-ui/shared/types";
import { RunInspector } from "./RunInspector.js";

afterEach(() => cleanup());

function fixture(): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: "run-a",
      trace_id: "trace-a",
      request_id: null,
      session_id: "session-a",
      parent_run_id: null,
      root_run_id: "run-a",
      tenant_id: "tenant-a",
      user_id: "user-a",
      workspace_id: "workspace-a",
      agent_id: "agent-a",
      provider_id: "provider-a",
      channel: "web",
      lifecycle_status: "completed",
      started_at_ms: 1,
      updated_at_ms: 2,
      completed_at_ms: 2,
      snapshot_seq: 501,
      correlation_state: "correlated",
      redaction: {
        metadata_only: true,
        debug_requested: false,
        debug_available: false,
      },
      usage: { total_tokens: 3, origin: "reported" },
    },
    events: Array.from({ length: 501 }, (_, index) => ({
      event_id: `event-${index + 1}`,
      event_seq: index + 1,
      event_kind: "run.delta",
      occurred_at_ms: index + 1,
    })),
    tool_calls: [],
    memory_lineage: [
      {
        lineage_seq: 1,
        relation: "used",
        memory_kind: "fact",
        memory_reference: "fact-a",
        tenant_id: "tenant-a",
        user_id: "user-a",
        workspace_id: "workspace-a",
        agent_id: "agent-a",
        source_episode_id: "episode-a",
        provenance: "episode-a",
        confidence: 0.9,
        occurred_at_ms: 2,
      },
    ],
  };
}

describe("RunInspector", () => {
  it("renders bounded, non-color metadata and backend-proven lineage", () => {
    render(
      <RunInspector
        snapshot={fixture()}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );
    expect(screen.getByText("Status: completed")).toBeDefined();
    expect(screen.getByText(/Metadata-only view/)).toBeDefined();
    const timeline = screen.getByRole("list", { name: "Run event timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(501);
    const lineageHeading = screen.getByRole("heading", {
      name: "Server-proven memory lineage",
    });
    const lineageItem = within(lineageHeading.closest("section")!).getByRole("listitem");
    expect(lineageItem.textContent).toMatch(/used\s*·\s*fact\s*·\s*fact-a/);
    expect(lineageItem.textContent).toContain("workspace/workspace-a");
    expect(lineageItem.textContent).toContain("source episode/episode-a");
    expect(screen.queryByRole("button", { name: "Request debug" })).toBeNull();
  });

  it("offers debug only for injected capability and clears plaintext immediately", async () => {
    const user = userEvent.setup();
    const requestDebug = vi.fn();
    const { rerender } = render(
      <RunInspector
        snapshot={fixture()}
        canRequestDebug
        onRequestDebug={requestDebug}
        onClearDebug={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "Request debug" }));
    expect(requestDebug).toHaveBeenCalledOnce();

    const clearDebug = vi.fn();
    rerender(
      <RunInspector
        snapshot={{
          ...fixture(),
          debug_excerpts: [
            {
              excerpt_seq: 1,
              kind: "provider_reasoning",
              plaintext: "sensitive plaintext",
              created_at_ms: 1,
              expires_at_ms: 10,
              plaintext_bytes: 19,
              truncated: false,
              redaction_count: 0,
            },
          ],
        }}
        canRequestDebug
        onRequestDebug={requestDebug}
        onClearDebug={clearDebug}
      />
    );
    expect(screen.getByText("sensitive plaintext")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Clear debug" }));
    expect(clearDebug).toHaveBeenCalledOnce();
  });

  it("renders 201 tool calls without truncation and calls stream pagination handlers", async () => {
    const user = userEvent.setup();
    const onLoadMoreEvents = vi.fn();
    const onLoadMoreTools = vi.fn();
    const onLoadMoreLineage = vi.fn();
    const onLoadMoreDebug = vi.fn();

    const snap: RunSnapshotDto = {
      ...fixture(),
      next_event_cursor: "c-events",
      next_tool_cursor: "c-tools",
      next_lineage_cursor: "c-lineage",
      next_debug_cursor: "c-debug",
      tool_calls: Array.from({ length: 201 }, (_, i) => ({
        tool_call_id: `tool-${i}`,
        ordinal: i,
        tool_name: "test_tool",
        status: "completed",
        started_at_ms: 1,
      })),
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "system_prompt",
          plaintext: "debug snippet",
          created_at_ms: 1,
          expires_at_ms: Date.now() + 60_000,
          plaintext_bytes: 13,
          truncated: false,
          redaction_count: 0,
        },
      ],
    };

    render(
      <RunInspector
        snapshot={snap}
        canRequestDebug
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
        onLoadMoreEvents={onLoadMoreEvents}
        onLoadMoreTools={onLoadMoreTools}
        onLoadMoreLineage={onLoadMoreLineage}
        onLoadMoreDebug={onLoadMoreDebug}
      />
    );

    // Verify all 201 tool calls rendered (not sliced to 200)
    expect(screen.getByText("201 loaded")).toBeDefined();
    const toolsSection = screen.getByRole("heading", { name: "Tool calls" }).closest("section")!;
    expect(within(toolsSection).getAllByRole("listitem")).toHaveLength(201);

    // Click load more buttons
    await user.click(screen.getByRole("button", { name: "Load more events" }));
    expect(onLoadMoreEvents).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Load more tools" }));
    expect(onLoadMoreTools).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Load more memory lineage" }));
    expect(onLoadMoreLineage).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Load more debug excerpts" }));
    expect(onLoadMoreDebug).toHaveBeenCalledOnce();
  });
});
