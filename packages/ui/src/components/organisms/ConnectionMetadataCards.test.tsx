// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectionMetadataCards } from "./ConnectionMetadataCards.js";
import type { AgentStatusResponse } from "@nonclaw-ui/shared/types";

afterEach(() => {
  cleanup();
});

describe("ConnectionMetadataCards", () => {
  it("renders valid status, model, uptime, and memory count", () => {
    const agentStatus: AgentStatusResponse = {
      status: "idle",
      model: "test-model",
      uptime_secs: 125,
      memory_count: 7,
    };

    render(<ConnectionMetadataCards agentStatus={agentStatus} config={null} />);

    expect(screen.getByText("Agent Status")).toBeDefined();
    expect(screen.getByText("idle")).toBeDefined();
    expect(screen.getByText("test-model")).toBeDefined();
    expect(screen.getByText("2m 5s")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("defensively renders fallback dashes when fields are missing or NaN", () => {
    const malformedStatus = {
      status: "",
      model: "",
      uptime_secs: undefined as unknown as number,
      memory_count: undefined as unknown as number,
    };

    render(<ConnectionMetadataCards agentStatus={malformedStatus as AgentStatusResponse} config={null} />);

    expect(screen.getByText("Agent Status")).toBeDefined();
    // All values fall back to "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(4);
    // Explicitly verify NaNm NaNs NEVER appears
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders null when both agentStatus and config are null", () => {
    const { container } = render(<ConnectionMetadataCards agentStatus={null} config={null} />);
    expect(container.firstChild).toBeNull();
  });
});
