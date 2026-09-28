// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RunTreeNodeDto,
  TaskProgressProjectionStatus,
  TaskProgressSnapshotDto,
  TaskProgressVerificationStatus,
} from "@eigen-air-ui/shared/types";
import {
  DelegationLifecyclePanel,
  PROJECTION_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
} from "./DelegationLifecyclePanel.js";

afterEach(() => cleanup());

function sampleTaskProgress(
  projection: TaskProgressProjectionStatus = "running",
  verification: TaskProgressVerificationStatus = "unverified"
): TaskProgressSnapshotDto {
  return {
    artifact_type: "task_progress",
    schema_version: 1,
    artifact_id: "artifact-1",
    root_session_id: "session-root",
    task_id: "task-1",
    subagent_run_id: "run-child",
    run_id: "run-child",
    trace_id: "trace-1",
    parent_run_id: "run-parent",
    root_run_id: "run-root",
    projection_status: projection,
    verification_status: verification,
    artifact_revision: 3,
    artifact_event_seq: 7,
    g2_snapshot_seq: 15,
    claimed_active_count: 2,
    claimed_item_count: 5,
    updated_at_ms: 1_700_000_000_000,
    terminal_at_ms: null,
    redaction: {
      metadata_only: true,
      hidden_fields: ["claimed_items.label", "evidence"],
    },
  };
}

describe("DelegationLifecyclePanel", () => {
  it("displays missing projection clearly without fabricating percentage or success", () => {
    render(<DelegationLifecyclePanel runId="run-1" taskProgress={null} />);
    expect(
      screen.getByText("Task progress projection not reported / unavailable for this run.")
    ).toBeDefined();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("exhaustively displays all eight projection states, distinguishing cancel_requested from terminal", () => {
    const states: TaskProgressProjectionStatus[] = [
      "queued",
      "running",
      "blocked",
      "partial",
      "cancel_requested",
      "cancelled",
      "failed",
      "succeeded",
    ];

    for (const st of states) {
      const { unmount } = render(
        <DelegationLifecyclePanel runId="run-1" taskProgress={sampleTaskProgress(st)} />
      );
      const badge = screen.getByTestId("projection-status");
      expect(badge.textContent).toBe(PROJECTION_STATUS_LABELS[st]);
      if (st === "cancel_requested") {
        expect(badge.textContent).toContain("not terminal");
      }
      unmount();
    }
  });

  it("exhaustively displays all three verification states with explicit lifecycle-only labeling", () => {
    const verifications: TaskProgressVerificationStatus[] = [
      "unverified",
      "verified_success",
      "verified_failure",
    ];

    for (const v of verifications) {
      const { unmount } = render(
        <DelegationLifecyclePanel
          runId="run-1"
          taskProgress={sampleTaskProgress("succeeded", v)}
        />
      );
      const badge = screen.getByTestId("verification-status");
      expect(badge.textContent).toBe(VERIFICATION_STATUS_LABELS[v]);
      expect(badge.textContent).toContain("lifecycle only");
      unmount();
    }
  });

  it("displays model-claimed counts labeled as unverified without percentage fabrication", () => {
    render(
      <DelegationLifecyclePanel
        runId="run-1"
        taskProgress={{
          ...sampleTaskProgress(),
          claimed_active_count: 1,
          claimed_item_count: 4,
        }}
      />
    );
    expect(
      screen.getByText("Model-claimed counts (unverified by server)")
    ).toBeDefined();
    expect(screen.getByText(/Total items:/).textContent).toContain("4");
    expect(screen.getByText(/Active items:/).textContent).toContain("1");
    // Verify no percentage was rendered
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("handles null trace_id, parent_run_id, root_run_id, and terminal_at_ms gracefully", () => {
    const progressWithNulls: TaskProgressSnapshotDto = {
      ...sampleTaskProgress(),
      trace_id: null,
      parent_run_id: null,
      root_run_id: null,
      terminal_at_ms: 1_700_000_050_000,
    };

    render(
      <DelegationLifecyclePanel
        runId="run-root"
        parentRunId={null}
        rootRunId={null}
        taskProgress={progressWithNulls}
      />
    );

    expect(screen.getByText(/None \(root run\)/)).toBeDefined();
    expect(screen.getByText(/trace Not reported/)).toBeDefined();
    expect(screen.getByText(/terminal/)).toBeDefined();
    expect(screen.getByText(/Metadata-only projection/)).toBeDefined();
  });

  it("navigates to parent and root runs on button click", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();

    render(
      <DelegationLifecyclePanel
        runId="run-child"
        parentRunId="run-parent"
        rootRunId="run-root"
        taskProgress={sampleTaskProgress()}
        onSelectRun={onSelectRun}
      />
    );

    const parentBtn = screen.getByRole("button", { name: "Navigate to parent run run-parent" });
    await user.click(parentBtn);
    expect(onSelectRun).toHaveBeenCalledWith("run-parent");

    const rootBtn = screen.getByRole("button", { name: "Navigate to root run run-root" });
    await user.click(rootBtn);
    expect(onSelectRun).toHaveBeenCalledWith("run-root");
  });

  it("renders authorized child runs and supports clicking through to child run", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();

    const nodes: RunTreeNodeDto[] = [
      {
        id: "node-1",
        root_session_id: "session-root",
        parent_session_id: "session-parent",
        child_session_id: "session-child-1",
        parent_run_id: "run-current",
        child_run_id: "run-child-1",
        root_run_id: "run-root",
        delegated_task_id: "task-child-1",
        source_agent_id: "agent-a",
        target_agent_id: "agent-b",
        depth: 1,
        created_at: 100,
      },
      {
        id: "node-2",
        root_session_id: "session-root",
        parent_session_id: "session-other",
        child_session_id: "session-child-2",
        parent_run_id: "run-other",
        child_run_id: "run-child-2",
        root_run_id: "run-root",
        delegated_task_id: "task-child-2",
        source_agent_id: "agent-a",
        target_agent_id: "agent-c",
        depth: 1,
        created_at: 101,
      },
    ];

    render(
      <DelegationLifecyclePanel
        runId="run-current"
        taskProgress={sampleTaskProgress()}
        runTreeNodes={nodes}
        onSelectRun={onSelectRun}
      />
    );

    const childBtn = screen.getByRole("button", { name: "Navigate to child run run-child-1" });
    expect(childBtn).toBeDefined();
    // node-2 is not a child of run-current, should not be rendered in this child list
    expect(screen.queryByRole("button", { name: "Navigate to child run run-child-2" })).toBeNull();

    await user.click(childBtn);
    expect(onSelectRun).toHaveBeenCalledWith("run-child-1");
  });

  it("handles loading, error, and empty states for run tree nodes", () => {
    const { rerender } = render(
      <DelegationLifecyclePanel
        runId="run-1"
        taskProgress={sampleTaskProgress()}
        runTreeLoading={true}
      />
    );
    expect(screen.getByText("Loading delegation hierarchy…")).toBeDefined();

    rerender(
      <DelegationLifecyclePanel
        runId="run-1"
        taskProgress={sampleTaskProgress()}
        runTreeLoading={false}
        runTreeError="Network timeout"
      />
    );
    expect(screen.getByText("Delegation hierarchy unavailable: Network timeout")).toBeDefined();

    rerender(
      <DelegationLifecyclePanel
        runId="run-1"
        taskProgress={sampleTaskProgress()}
        runTreeLoading={false}
        runTreeNodes={[]}
      />
    );
    expect(
      screen.getByText(/No known child runs in authorized run tree/)
    ).toBeDefined();
  });
});
