// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto } from "@nonclaw-ui/shared/types";
import { RunInspector } from "./RunInspector.js";

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
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(500);
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
});
