// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => cleanup());
import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { MemoryOutcomesPanel } from "./MemoryOutcomesPanel.js";

function makeOutcomeEvent(
  outcomeOverrides: Partial<NonNullable<RunEventDto["memory_outcome"]>> = {},
  eventOverrides: Partial<RunEventDto> = {},
): RunEventDto {
  return {
    event_id: "evt-mem-1",
    event_seq: 1,
    event_kind: "memory_outcome",
    occurred_at_ms: 1727500000000,
    memory_outcome: {
      schema_version: "memory_outcome.v1",
      operation_id: "op-flush-1",
      operation_kind: "episode_flush",
      state: "stored",
      reason: "stored",
      episode_reference: "ep-123",
      fact_count: 3,
      ...outcomeOverrides,
    },
    ...eventOverrides,
  };
}

describe("MemoryOutcomesPanel", () => {
  it("renders unavailable state when no memory outcome events exist", () => {
    render(<MemoryOutcomesPanel events={[]} />);

    expect(screen.getByRole("heading", { name: "Durable memory outcomes" })).toBeDefined();
    expect(
      screen.getByText("Memory outcome unavailable (no outcome reported by server)."),
    ).toBeDefined();
    expect(screen.queryByText(/recorded/)).toBeNull();
  });

  it("renders stored outcome with exact-scope episode reference and navigation action", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const event = makeOutcomeEvent({
      state: "stored",
      reason: "stored",
      episode_reference: "ep-stored-123",
      fact_count: 4,
    });

    render(<MemoryOutcomesPanel events={[event]} onNavigate={onNavigate} />);

    expect(screen.getByText("1 recorded")).toBeDefined();
    expect(screen.getByText("Stored")).toBeDefined();
    expect(screen.getByText("op-flush-1")).toBeDefined();
    expect(screen.getByText("reason: Stored")).toBeDefined();
    expect(screen.getByText("committed: 4 facts")).toBeDefined();

    const viewButton = screen.getByRole("button", { name: "View episode ep-stored-123" });
    expect(viewButton).toBeDefined();

    await user.click(viewButton);
    expect(onNavigate).toHaveBeenCalledWith("/memory?episode_id=ep-stored-123");
  });

  it("renders stored outcome with zero facts cleanly", () => {
    const event = makeOutcomeEvent({
      state: "stored",
      reason: "stored",
      episode_reference: "ep-zero-1",
      fact_count: 0,
    });

    render(<MemoryOutcomesPanel events={[event]} />);

    expect(screen.getByText("committed: 0 facts")).toBeDefined();
  });

  it("renders stored outcome with redacted source reference", () => {
    const event = makeOutcomeEvent({
      state: "stored",
      reason: "stored",
      episode_reference: undefined,
      fact_count: 2,
    });

    render(<MemoryOutcomesPanel events={[event]} />);

    expect(screen.getByText("Stored")).toBeDefined();
    expect(screen.getByText("committed: 2 facts")).toBeDefined();
    expect(
      screen.getByText("source reference redacted (requires exact memory scope)"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /View episode/ })).toBeNull();
  });

  it("renders skipped outcome with safe reason and no facts committed message", () => {
    const event = makeOutcomeEvent({
      state: "skipped",
      reason: "sensitive_content",
      episode_reference: undefined,
      fact_count: undefined,
    });

    render(<MemoryOutcomesPanel events={[event]} />);

    expect(screen.getByText("Skipped")).toBeDefined();
    expect(screen.getByText("reason: Sensitive content detected")).toBeDefined();
    expect(screen.getByText("no facts committed (skipped)")).toBeDefined();
    expect(screen.queryByRole("button", { name: /View episode/ })).toBeNull();
  });

  it("renders failed outcome distinguishing partial write from unknown", () => {
    const partialEvent = makeOutcomeEvent(
      {
        operation_id: "op-fail-partial",
        state: "failed",
        reason: "write_failed",
        episode_reference: "ep-partial-1",
        fact_count: 2,
      },
      { event_id: "evt-partial", event_seq: 1 },
    );

    const unknownEvent = makeOutcomeEvent(
      {
        operation_id: "op-fail-unknown",
        state: "failed",
        reason: "write_failed",
        episode_reference: undefined,
        fact_count: undefined,
      },
      { event_id: "evt-unknown", event_seq: 2 },
    );

    render(<MemoryOutcomesPanel events={[partialEvent, unknownEvent]} />);

    expect(screen.getByText("2 recorded")).toBeDefined();
    expect(
      screen.getByText("partial write: 2 facts committed before failure"),
    ).toBeDefined();
    expect(screen.getByText("write failed (committed facts unknown)")).toBeDefined();
  });

  it("renders multiple operations separated cleanly", () => {
    const event1 = makeOutcomeEvent(
      {
        operation_id: "op-flush-first",
        state: "stored",
        reason: "stored",
        episode_reference: "ep-1",
        fact_count: 1,
      },
      { event_id: "evt-1", event_seq: 1 },
    );

    const event2 = makeOutcomeEvent(
      {
        operation_id: "op-flush-second",
        state: "skipped",
        reason: "no_identity",
        episode_reference: undefined,
        fact_count: undefined,
      },
      { event_id: "evt-2", event_seq: 2 },
    );

    render(<MemoryOutcomesPanel events={[event1, event2]} />);

    expect(screen.getByText("2 recorded")).toBeDefined();
    expect(screen.getByText("op-flush-first")).toBeDefined();
    expect(screen.getByText("op-flush-second")).toBeDefined();
  });
});
