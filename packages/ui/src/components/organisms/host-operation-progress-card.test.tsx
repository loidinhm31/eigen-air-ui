// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperationSnapshot } from "@eigen-air-ui/shared/types";
import { HostOperationProgressCard } from "./host-operation-progress-card.js";

afterEach(() => {
  cleanup();
});
function makeOp(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
  return {
    operation_id: "op-test-1",
    host_id: "host-1",
    artifact_id: "gemma-4-e4b-it-qat-q4_0",
    kind: "unload",
    state: "completed",
    stage: "completed",
    revision: 1,
    counters: {},
    started_at_ms: Date.now() - 5000,
    completed_at_ms: Date.now(),
    ...overrides,
  };
}

describe("HostOperationProgressCard", () => {
  it("renders 'Completed' and no 'In progress' for completed operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "completed", stage: "completed" })} />);

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it("renders 'Failed' and error message for failed operation without units", () => {
    render(
      <HostOperationProgressCard
        operation={makeOp({
          state: "failed",
          stage: "failed",
          error_message: "Host operation failed",
        })}
      />
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.getByText("Host operation failed")).toBeTruthy();
  });

  it("renders 'Cancelled' for cancelled operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "cancelled", stage: "cancelled" })} />);

    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it("renders 'Outcome unknown' for indeterminate operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "indeterminate", stage: "indeterminate" })} />);

    expect(screen.getByText("Outcome unknown")).toBeTruthy();
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it("renders 'Queued' for queued active operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "queued", stage: "queued" })} />);

    expect(screen.getByText("Queued")).toBeTruthy();
  });

  it("renders 'Cancelling...' for cancelling active operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "cancelling", stage: "cancelling" })} />);

    expect(screen.getByText("Cancelling...")).toBeTruthy();
  });

  it("renders 'In progress' for running active operation without units", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "running", stage: "executing" })} />);

    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("does not duplicate stage badge when stage matches state", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "completed", stage: "completed" })} />);

    expect(screen.getByTestId("operation-state-op-test-1").textContent).toBe("completed");
    // Stage badge with text-muted-foreground is omitted when stage matches state
    const stageBadge = screen.queryByText("completed", { selector: ".text-muted-foreground" });
    expect(stageBadge).toBeNull();
  });

  it("shows stage badge when stage differs from state", () => {
    render(<HostOperationProgressCard operation={makeOp({ state: "completed", stage: "deletion_verified" })} />);

    expect(screen.getByText("deletion verified")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
  });

  it("renders Dismiss button on terminal operation and calls onDismiss", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<HostOperationProgressCard operation={makeOp({ state: "completed" })} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByTestId("dismiss-operation-op-test-1");
    expect(dismissBtn).toBeTruthy();
    await user.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith("op-test-1");
  });

  it("renders Cancel button on active operation and no Dismiss button", () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    render(
      <HostOperationProgressCard
        operation={makeOp({ state: "running" })}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByTestId("cancel-operation-op-test-1")).toBeTruthy();
    expect(screen.queryByTestId("dismiss-operation-op-test-1")).toBeNull();
  });

  it("does not pulse Activity icon on terminal operations", () => {
    const { container } = render(<HostOperationProgressCard operation={makeOp({ state: "completed" })} />);

    const activityIcon = container.querySelector(".lucide-activity");
    expect(activityIcon?.classList.contains("animate-pulse")).toBe(false);
  });

  it("pulses Activity icon on active operations", () => {
    const { container } = render(<HostOperationProgressCard operation={makeOp({ state: "running" })} />);

    const activityIcon = container.querySelector(".lucide-activity");
    expect(activityIcon?.classList.contains("animate-pulse")).toBe(true);
  });

  it("only displays live ETA and tok/s for active operations", () => {
    const { rerender } = render(
      <HostOperationProgressCard
        operation={makeOp({
          state: "completed",
          counters: { tokens_per_second: 15.5, estimated_remaining_seconds: 10 },
        })}
      />
    );

    expect(screen.queryByText(/tok\/s/)).toBeNull();
    expect(screen.queryByText(/ETA:/)).toBeNull();

    rerender(
      <HostOperationProgressCard
        operation={makeOp({
          state: "running",
          counters: { tokens_per_second: 15.5, estimated_remaining_seconds: 10 },
        })}
      />
    );

    expect(screen.getByText("15.5 tok/s")).toBeTruthy();
    expect(screen.getByText("ETA: 10s")).toBeTruthy();
  });
});
