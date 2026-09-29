// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());
import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { TaskOutcomesPanel } from "./TaskOutcomesPanel.js";

function makeTaskOutcomeEvent(
  outcomeOverrides: Partial<NonNullable<RunEventDto["task_outcome"]>> = {},
  eventOverrides: Partial<RunEventDto> = {},
): RunEventDto {
  return {
    event_id: "evt-task-1",
    event_seq: 1,
    event_kind: "task_outcome",
    occurred_at_ms: 1727500000000,
    task_outcome: {
      schema_version: "task_outcome.v1",
      task_id: "task-100",
      checker_id: "research_artifact_checker",
      checker_version: "v1",
      artifact_path: "reports/research_result.json",
      artifact_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      status: "passed",
      reason: "valid",
      details: "All checks passed",
      evaluated_at_ms: 1727500000000,
      ...outcomeOverrides,
    },
    ...eventOverrides,
  };
}

describe("TaskOutcomesPanel", () => {
  it("renders empty message when no task outcome events exist", () => {
    render(<TaskOutcomesPanel events={[]} />);

    expect(screen.getByRole("heading", { name: "Task outcome verification" })).toBeDefined();
    expect(
      screen.getByText("No task outcome evaluation recorded for this run."),
    ).toBeDefined();
    expect(screen.queryByText(/evaluated/)).toBeNull();
  });

  it("renders passed task outcome with details and digest", () => {
    const evt = makeTaskOutcomeEvent();
    render(<TaskOutcomesPanel events={[evt]} />);

    expect(screen.getByText("PASSED")).toBeDefined();
    expect(screen.getByText("research_artifact_checker:v1")).toBeDefined();
    expect(screen.getByText("reports/research_result.json")).toBeDefined();
    expect(screen.getByText("Valid (all checks passed)")).toBeDefined();
    expect(screen.getByText("All checks passed")).toBeDefined();
    expect(screen.getByText("1 evaluated")).toBeDefined();
  });

  it("renders failed task outcome with failure reason", () => {
    const evt = makeTaskOutcomeEvent({
      status: "failed",
      reason: "unreferenced_citation",
      details: "Text cites S99 not in sources",
    });
    render(<TaskOutcomesPanel events={[evt]} />);

    expect(screen.getByText("FAILED")).toBeDefined();
    expect(screen.getByText("Unreferenced citation")).toBeDefined();
    expect(screen.getByText("Text cites S99 not in sources")).toBeDefined();
  });

  it("renders error task outcome with missing artifact reason", () => {
    const evt = makeTaskOutcomeEvent({
      status: "error",
      reason: "artifact_missing",
      details: "File not found on disk",
    });
    render(<TaskOutcomesPanel events={[evt]} />);

    expect(screen.getByText("ERROR")).toBeDefined();
    expect(screen.getByText("Artifact file missing")).toBeDefined();
    expect(screen.getByText("File not found on disk")).toBeDefined();
  });
});
