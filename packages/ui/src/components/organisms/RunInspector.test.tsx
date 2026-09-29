// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunSnapshotDto, ToolApprovalSnapshot } from "@eigen-air-ui/shared/types";
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
    expect(lineageItem.textContent).toMatch(/used \(included in request\)\s*·\s*knowledge fact tier\s*·\s*fact-a/);
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

  it("renders truthful identity, duration, and split usage counters independently", () => {
    const snap: RunSnapshotDto = {
      ...fixture(),
      run: {
        ...fixture().run,
        provider_id: "provider-xyz",
        agent_id: "agent-xyz",
        channel: "cli",
        started_at_ms: 1000,
        completed_at_ms: 2500,
        updated_at_ms: 2500,
        usage: {
          prompt_tokens: 12,
          completion_tokens: 34,
          total_tokens: 46,
          origin: "reported",
        },
      },
    };

    render(
      <RunInspector
        snapshot={snap}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getByText(/provider provider-xyz · agent agent-xyz · channel cli/)).toBeDefined();
    expect(screen.getByText(/duration 1500 ms/)).toBeDefined();
    expect(
      screen.getByText(
        /46 total tokens \(reported\) · prompt: 12 · completion: 34/
      )
    ).toBeDefined();
  });

  it("handles null usage, missing counters without fabricating totals, and inverted timestamps", () => {
    // 1. Inverted timestamp
    const snapInverted: RunSnapshotDto = {
      ...fixture(),
      run: {
        ...fixture().run,
        started_at_ms: 5000,
        completed_at_ms: 2000,
        usage: null,
      },
    };

    const { rerender } = render(
      <RunInspector
        snapshot={snapInverted}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getByText(/duration unavailable \(invalid timestamp range\)/)).toBeDefined();
    expect(screen.getByText("No usage reported by server.")).toBeDefined();

    // 2. Missing total tokens does not fabricate sum from prompt + completion
    const snapMissingTotal: RunSnapshotDto = {
      ...fixture(),
      run: {
        ...fixture().run,
        started_at_ms: 1000,
        completed_at_ms: null,
        updated_at_ms: 3500,
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: null,
          origin: "estimated",
        },
      },
    };

    rerender(
      <RunInspector
        snapshot={snapMissingTotal}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getByText(/duration 2500 ms \(ongoing elapsed\)/)).toBeDefined();
    expect(
      screen.getByText(
        /unknown total tokens \(estimated\) · prompt: 15 · completion: 25/
      )
    ).toBeDefined();

    // 3. Zero counters are preserved as 0, not "unknown"
    const snapZeroCounters: RunSnapshotDto = {
      ...fixture(),
      run: {
        ...fixture().run,
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          origin: "reported",
        },
      },
    };

    rerender(
      <RunInspector
        snapshot={snapZeroCounters}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(
      screen.getByText(/0 total tokens \(reported\) · prompt: 0 · completion: 0/)
    ).toBeDefined();
  });

  it("renders tool call timing, safe error code, and failure fallback without fabricating duration", () => {
    const snap: RunSnapshotDto = {
      ...fixture(),
      tool_calls: [
        {
          tool_call_id: "tool-valid",
          ordinal: 1,
          tool_name: "fetch_data",
          status: "completed",
          started_at_ms: 1000,
          completed_at_ms: 1600,
          safe_error_code: null,
        },
        {
          tool_call_id: "tool-err",
          ordinal: 2,
          tool_name: "exec_cmd",
          status: "failed",
          started_at_ms: 2000,
          completed_at_ms: 2200,
          safe_error_code: "policy_denied",
        },
        {
          tool_call_id: "tool-fail-no-code",
          ordinal: 3,
          tool_name: "broken_tool",
          status: "failed",
          started_at_ms: 3000,
          completed_at_ms: 3100,
          safe_error_code: null,
        },
        {
          tool_call_id: "tool-ongoing",
          ordinal: 4,
          tool_name: "long_task",
          status: "running",
          started_at_ms: 4000,
          completed_at_ms: null,
          safe_error_code: null,
        },
      ],
    };

    render(
      <RunInspector
        snapshot={snap}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getByText("duration: 600 ms")).toBeDefined();
    expect(screen.getByText("duration: 200 ms")).toBeDefined();
    expect(screen.getByText("Safe error: policy_denied")).toBeDefined();
    expect(screen.getByText("Failed (no error code reported)")).toBeDefined();
    expect(screen.getByText("duration: ongoing")).toBeDefined();
  });

  it("renders exact-scope tool selection diagnostics with reasons and breakdown", () => {
    const snap: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-tool-sel",
          event_seq: 1,
          event_kind: "tool_selection",
          occurred_at_ms: 1727500000000,
          tool_selection: {
            schema_version: "tool_selection.v1",
            effective_cap: 3,
            cap_source: "configured_profile",
            checked_count: 5,
            eligible_count: 4,
            selected_count: 2,
            rejected_count: 2,
            required_count: 1,
            context_count: 1,
            optional_count: 1,
            global_count: 1,
            selected_total: 2,
            selected_omitted: 0,
            rejected_total: 2,
            rejected_omitted: 0,
            reason_counts: {
              required_selected: 1,
              security_denied: 1,
            },
            order_hash: "a1b2c3d4e5f67890",
            selected_tools: [
              { canonical_name: "quote_tool", reason_code: "required_selected" },
            ],
            rejected_tools: [
              { canonical_name: "danger_tool", reason_code: "security_denied" },
            ],
          },
        },
      ],
    };

    render(
      <RunInspector
        snapshot={snap}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getAllByText(/Cap: 3 \(configured_profile\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Schemas: 5 checked · 4 eligible · 2 selected · 2 rejected/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Breakdown: 1 required · 1 context · 1 optional · 1 global/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/quote_tool/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/danger_tool/).length).toBeGreaterThan(0);
  });

  it("renders redacted tool selection diagnostics without leaking names and handles zero cap incompatible state", () => {
    const snap: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-tool-redacted",
          event_seq: 1,
          event_kind: "tool_selection",
          occurred_at_ms: 1727500000000,
          tool_selection: {
            schema_version: "tool_selection.v1",
            effective_cap: 0,
            cap_source: "cap_zero",
            checked_count: 3,
            eligible_count: 3,
            selected_count: 0,
            rejected_count: 3,
            required_count: 2,
            selected_omitted: 0,
            rejected_omitted: 1,
            rejected_total: 3,
            name_details_redacted: true,
          },
        },
      ],
    };

    render(
      <RunInspector
        snapshot={snap}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    // Incompatible zero cap alert
    expect(
      screen.getAllByText(
        "Zero cap with required tools: incompatible tool budget (execution blocked)"
      ).length
    ).toBeGreaterThan(0);

    // Redaction marker present and no tool names leaked
    expect(
      screen.getAllByText(
        "Tool names redacted (requires exact-scope authorization)."
      ).length
    ).toBeGreaterThan(0);

    // Omission rendered
    expect(
      screen.getAllByText(/1 rejected schemas omitted \(total: 3\)/).length
    ).toBeGreaterThan(0);
  });

  it("handles unsupported schema version and runs with no diagnostics gracefully", () => {
    const snapUnsupported: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-unknown-schema",
          event_seq: 1,
          event_kind: "tool_selection",
          occurred_at_ms: 1000,
          tool_selection: {
            schema_version: "tool_selection.v99",
          },
        },
      ],
    };

    const { rerender } = render(
      <RunInspector
        snapshot={snapUnsupported}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(
      screen.getAllByText(
        /Tool selection diagnostic unavailable \(unsupported schema version: tool_selection.v99\)/
      ).length
    ).toBeGreaterThan(0);

    // Run with no diagnostics
    const snapEmpty: RunSnapshotDto = {
      ...fixture(),
      events: [],
    };

    rerender(
      <RunInspector
        snapshot={snapEmpty}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />
    );

    expect(screen.getByText("No tool selection diagnostics reported.")).toBeDefined();
  });

  it("renders durable memory outcomes panel with outcome details and unavailable fallback", () => {
    const snapWithOutcome: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-mem-out-1",
          event_seq: 1,
          event_kind: "memory_outcome",
          occurred_at_ms: 1000,
          memory_outcome: {
            schema_version: "memory_outcome.v1",
            operation_id: "op-flush-100",
            operation_kind: "episode_flush",
            state: "stored",
            reason: "stored",
            episode_reference: "ep-outcome-100",
            fact_count: 5,
          },
        },
      ],
    };

    const { rerender } = render(
      <RunInspector
        snapshot={snapWithOutcome}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Durable memory outcomes" })).toBeDefined();
    expect(screen.getByText("op-flush-100")).toBeDefined();
    expect(screen.getByText("committed: 5 facts")).toBeDefined();
    expect(screen.getByRole("button", { name: "View episode ep-outcome-100" })).toBeDefined();

    // Rerender with no memory outcome events (legacy run)
    const snapLegacy: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-legacy-1",
          event_seq: 1,
          event_kind: "run.delta",
          occurred_at_ms: 1000,
        },
      ],
    };

    rerender(
      <RunInspector
        snapshot={snapLegacy}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Memory outcome unavailable (no outcome reported by server)."),
    ).toBeDefined();
  });

  it("renders request provenance panel with provenance details and unavailable fallback", () => {
    const snapWithProvenance: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-prov-100",
          event_seq: 1,
          event_kind: "request_provenance",
          occurred_at_ms: 1000,
          request_provenance: {
            schema_version: "request_provenance.v1",
            logical_request_id: "req-inspector-1",
            provider_id: "local_llama",
            provider_profile_id: "profile-test",
            provider_profile_revision: 1727500000,
            model: "qwen2.5-7b",
            selected_skill_id: "web_search",
            skill_content_revision: "rev-2",
            prompt_format_version: "eigen-air-prompt-v1",
            section_summaries: [
              {
                section: "identity",
                present: true,
                estimated_tokens: 30,
                origin: "estimate",
              },
            ],
          },
        },
      ],
    };

    const { rerender } = render(
      <RunInspector
        snapshot={snapWithProvenance}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Request provenance" })).toBeDefined();
    expect(screen.getByText("req req-inspector-1")).toBeDefined();
    expect(screen.getByText(/profile-test/)).toBeDefined();
    expect(screen.getByText(/web_search/)).toBeDefined();

    // Rerender with no request provenance events (legacy run)
    const snapLegacy: RunSnapshotDto = {
      ...fixture(),
      events: [],
    };

    rerender(
      <RunInspector
        snapshot={snapLegacy}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Request provenance unavailable (no provenance reported by server)."),
    ).toBeDefined();
  });

  it("renders task outcome verification panel with evaluated details and unavailable fallback", () => {
    const snapWithOutcome: RunSnapshotDto = {
      ...fixture(),
      events: [
        {
          event_id: "evt-task-out-1",
          event_seq: 1,
          event_kind: "task_outcome",
          occurred_at_ms: 1000,
          task_outcome: {
            schema_version: "task_outcome.v1",
            task_id: "task-inspector-1",
            checker_id: "research_artifact_checker",
            checker_version: "v1",
            artifact_path: "reports/research_result.json",
            artifact_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status: "passed",
            reason: "valid",
            details: "All checks passed",
            evaluated_at_ms: 1000,
          },
        },
      ],
    };

    const { rerender } = render(
      <RunInspector
        snapshot={snapWithOutcome}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Task outcome verification" })).toBeDefined();
    expect(screen.getByText("PASSED")).toBeDefined();
    expect(screen.getByText("research_artifact_checker:v1")).toBeDefined();
    expect(screen.getByText("reports/research_result.json")).toBeDefined();

    // Rerender with no task outcome events
    const snapLegacy: RunSnapshotDto = {
      ...fixture(),
      events: [],
    };

    rerender(
      <RunInspector
        snapshot={snapLegacy}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No task outcome evaluation recorded for this run."),
    ).toBeDefined();
  });

  it("renders historical tool approvals panel with recorded approvals, empty state, and refresh action", async () => {
    const sampleApproval: ToolApprovalSnapshot = {
      approval_id: "app-inspector-1",
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
        working_dir: "/root",
      },
      binding_digest: "9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
      revision: 1,
      created_at_ms: 1000,
      expires_at_ms: 2000,
      terminal_at_ms: null,
      terminal_code: null,
      decision_by_credential_id: "cred-admin",
      redaction: "metadata_only",
    };

    const onRefresh = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <RunInspector
        snapshot={fixture()}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
        historicalApprovals={[sampleApproval]}
        onRefreshHistoricalApprovals={onRefresh}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tool approvals" })).toBeDefined();
    expect(screen.getByText("shell.execute")).toBeDefined();
    expect(screen.getByText("Accepted (allow_once)")).toBeDefined();
    expect(screen.getByText("Approved (permit pending claim)")).toBeDefined();
    expect(screen.getByText("Permit issued (unclaimed)")).toBeDefined();

    const refreshBtn = screen.getByRole("button", { name: "Refresh tool approvals" });
    await user.click(refreshBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Rerender with empty approvals
    rerender(
      <RunInspector
        snapshot={fixture()}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
        historicalApprovals={[]}
      />,
    );
    expect(screen.getByText("No tool approvals recorded for this run.")).toBeDefined();

    // Rerender with error
    rerender(
      <RunInspector
        snapshot={fixture()}
        canRequestDebug={false}
        onRequestDebug={vi.fn()}
        onClearDebug={vi.fn()}
        historicalApprovals={[]}
        historicalApprovalsError="Failed to load approvals"
      />,
    );
    expect(screen.getByText("Failed to load approvals")).toBeDefined();
  });
});
