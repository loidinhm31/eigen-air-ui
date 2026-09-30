// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RunToolCallDto,
  ToolApprovalSnapshot,
} from "@eigen-air-ui/shared/types";
import {
  HistoricalToolApprovalsPanel,
  formatDecisionState,
  formatExecutionLifecycle,
} from "./HistoricalToolApprovalsPanel.js";

afterEach(cleanup);

const baseProgramApproval: ToolApprovalSnapshot = {
  approval_id: "app-program-1",
  schema_version: "tool_approval.v1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
  run_id: "run-1",
  tool_call_id: "call-1",
  ordinal: 0,
  tool_name: "shell",
  operation: "execute",
  risk: "high",
  state: "consumed",
  safe_summary: {
    program: "rm",
    args_count: 2,
    working_dir: "/workspace/project",
  },
  binding_digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  revision: 2,
  created_at_ms: 1_700_000_000_000,
  expires_at_ms: 1_700_000_900_000,
  terminal_at_ms: 1_700_000_050_000,
  terminal_code: "consumed",
  decision_by_credential_id: "cred-user-alice",
  redaction: "metadata_only",
};

const baseTemplateApproval: ToolApprovalSnapshot = {
  approval_id: "app-template-1",
  schema_version: "tool_approval.v1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
  run_id: "run-1",
  tool_call_id: "call-2",
  ordinal: 1,
  tool_name: "deploy_skill",
  operation: "apply",
  risk: "high",
  state: "indeterminate",
  safe_summary: {
    tool_name: "deploy_skill",
    template_preview: "helm install app-release ./chart",
    param_names: ["release_name", "chart_path"],
    working_dir: "/workspace/deploy",
  },
  binding_digest: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  revision: 3,
  created_at_ms: 1_700_000_100_000,
  expires_at_ms: 1_700_000_900_000,
  terminal_at_ms: 1_700_000_200_000,
  terminal_code: "approval_indeterminate",
  decision_by_credential_id: "cred-user-bob",
  redaction: "metadata_only",
};

const sampleToolCallSucceeded: RunToolCallDto = {
  tool_call_id: "call-1",
  ordinal: 0,
  tool_name: "shell",
  status: "completed",
  policy_outcome: "allowed",
  started_at_ms: 1_700_000_010_000,
  completed_at_ms: 1_700_000_040_000,
};

const sampleToolCallFailed: RunToolCallDto = {
  tool_call_id: "call-2",
  ordinal: 1,
  tool_name: "deploy_skill",
  status: "failed",
  safe_error_code: "process_terminated",
  started_at_ms: 1_700_000_110_000,
  completed_at_ms: 1_700_000_190_000,
};

describe("HistoricalToolApprovalsPanel", () => {
  it("renders empty state message when no approvals are recorded", () => {
    render(<HistoricalToolApprovalsPanel approvals={[]} />);
    expect(
      screen.getByText("No tool approvals recorded for this run.")
    ).toBeDefined();
    expect(screen.queryByLabelText("Tool approval records")).toBeNull();
  });

  it("renders loading message when loading and no approvals are present", () => {
    render(<HistoricalToolApprovalsPanel approvals={[]} isLoading={true} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Loading tool approvals…"
    );
  });

  it("renders error message when error is provided", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[]}
        error="Permission denied loading approvals"
      />
    );
    expect(
      screen.getByText("Permission denied loading approvals")
    ).toBeDefined();
  });

  it("triggers onRefresh callback when refresh button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        onRefresh={onRefresh}
      />
    );

    const refreshButton = screen.getByRole("button", {
      name: "Refresh tool approvals",
    });
    await user.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("displays header, count, operation, revision, and digest", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        toolCalls={[sampleToolCallSucceeded]}
      />
    );

    expect(screen.getByText("1 recorded")).toBeDefined();
    expect(screen.getByText("shell.execute")).toBeDefined();
    expect(
      screen.getByText(
        /approval app-program-1 · tool call call-1 · ordinal 0 · rev 2/
      )
    ).toBeDefined();
    expect(screen.getByText("digest abcdef0123456789…")).toBeDefined();
  });

  it("displays program safe summary preserving 512-byte bound fields", () => {
    render(
      <HistoricalToolApprovalsPanel approvals={[baseProgramApproval]} />
    );

    expect(screen.getByText("rm")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("/workspace/project")).toBeDefined();
  });

  it("displays template safe summary preserving preview and param names", () => {
    render(
      <HistoricalToolApprovalsPanel approvals={[baseTemplateApproval]} />
    );

    expect(
      screen.getByText("helm install app-release ./chart")
    ).toBeDefined();
    expect(screen.getByText("release_name, chart_path")).toBeDefined();
    expect(screen.getByText("/workspace/deploy")).toBeDefined();
  });

  it("correlates exact tool call by tool_call_id and shows completed tool result", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        toolCalls={[sampleToolCallSucceeded]}
      />
    );

    expect(screen.getByText("Tool completed (succeeded)")).toBeDefined();
    expect(screen.getByText(/policy: allowed/)).toBeDefined();
    expect(screen.getByText(/duration: 30000 ms/)).toBeDefined();
  });

  it("correlates exact tool call by tool_call_id and shows failed tool result with safe error code", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseTemplateApproval]}
        toolCalls={[sampleToolCallFailed]}
      />
    );

    expect(
      screen.getByText("Tool failed (process_terminated)")
    ).toBeDefined();
    expect(screen.getByText("Safe error: process_terminated")).toBeDefined();
  });

  it("displays unavailable when G2 tool call is missing from snapshot", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        toolCalls={[]}
      />
    );

    expect(
      screen.getByText(
        "Unavailable (no matching tool call recorded in run snapshot)"
      )
    ).toBeDefined();
    expect(
      screen.getByText(/No G2 tool execution snapshot was recorded with call ID call-1/)
    ).toBeDefined();
  });

  it("explicitly presents observed effect as unknown with no inference", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        toolCalls={[sampleToolCallSucceeded]}
      />
    );

    expect(screen.getByText("Explicitly unknown")).toBeDefined();
    expect(
      screen.getByText(
        "Runtime policy does not infer or verify arbitrary shell or tool side-effects from execution or permit state."
      )
    ).toBeDefined();
  });

  it("enforces that permit consumed does NOT imply execution success", () => {
    const failedCallForCall1: RunToolCallDto = {
      ...sampleToolCallFailed,
      tool_call_id: "call-1",
    };
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseProgramApproval]}
        toolCalls={[failedCallForCall1]}
      />
    );

    const consumedLabels = screen.getAllByText("Permit consumed");
    expect(consumedLabels.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        "Note: Permit consumed indicates permit usage only; it does not imply tool execution success."
      )
    ).toBeDefined();
    expect(
      screen.getByText("Tool failed (process_terminated)")
    ).toBeDefined();
  });
  it("handles indeterminate state with no auto-retry and no allow-always button", () => {
    render(
      <HistoricalToolApprovalsPanel
        approvals={[baseTemplateApproval]}
        toolCalls={[sampleToolCallFailed]}
      />
    );

    expect(
      screen.getByText("Accepted (indeterminate execution)")
    ).toBeDefined();
    expect(screen.getByText("Indeterminate")).toBeDefined();
    expect(
      screen.getByText(
        "Execution lease expired or process lost during run (indeterminate; no automatic retry)"
      )
    ).toBeDefined();

    // Verify negative security assertions: NO allow-always button, NO auto-retry button
    expect(screen.queryByRole("button", { name: /allow-always/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /always/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /auto-retry/i })).toBeNull();
  });

  it("correctly formats decision and execution lifecycle states across all enum values", () => {
    const states: ToolApprovalSnapshot["state"][] = [
      "pending",
      "approved_once",
      "claimed",
      "executing",
      "consumed",
      "denied",
      "expired",
      "cancelled",
      "indeterminate",
    ];

    for (const state of states) {
      const decision = formatDecisionState(state, "cred-test");
      expect(decision.label).toBeDefined();
      expect(decision.detail).toBeDefined();

      const lifecycle = formatExecutionLifecycle(state);
      expect(lifecycle.label).toBeDefined();
      expect(lifecycle.detail).toBeDefined();
    }
  });
  it("displays 'loaded, possibly incomplete' when approval count is 100 or more", () => {
    const manyApprovals = Array.from({ length: 100 }, (_, i) => ({
      ...baseProgramApproval,
      approval_id: `app-${i}`,
      tool_call_id: `call-${i}`,
    }));
    render(<HistoricalToolApprovalsPanel approvals={manyApprovals} />);
    expect(screen.getByText("100 loaded, possibly incomplete")).toBeDefined();
  });

  it("indicates unmatched tool call is not in loaded snapshot when hasMoreTools is true", () => {
    render(<HistoricalToolApprovalsPanel approvals={[baseProgramApproval]} toolCalls={[]} hasMoreTools={true} />);
    expect(screen.getByText("Unavailable (tool call not in loaded snapshot)")).toBeDefined();
    expect(
      screen.getByText("Tool call with ID call-1 was not in loaded snapshot page; additional tool history remains on server.")
    ).toBeDefined();
  });
});
