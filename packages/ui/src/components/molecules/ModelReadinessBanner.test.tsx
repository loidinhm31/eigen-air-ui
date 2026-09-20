// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelReadinessBanner } from "./ModelReadinessBanner.js";
import type { ProviderReadinessSnapshot } from "@nonclaw-ui/shared/types";

afterEach(() => {
  cleanup();
});

describe("ModelReadinessBanner", () => {
  it("renders nothing when phase is ready or idle", () => {
    const { container: c1 } = render(
      <ModelReadinessBanner phase="ready" snapshot={null} error={null} />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <ModelReadinessBanner phase="idle" snapshot={null} error={null} />
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders checking state", () => {
    render(<ModelReadinessBanner phase="checking" snapshot={null} error={null} />);
    expect(screen.getByText("Checking model readiness...")).toBeDefined();
  });

  it("renders starting state with progressive disclosure and skipped cache stage", async () => {
    const user = userEvent.setup();
    const snapshot: ProviderReadinessSnapshot = {
      status: "starting",
      retryable: true,
      details: {
        stages: [
          { name: "config_validation", status: "completed", elapsed_ms: 12 },
          {
            name: "cache_initialization",
            status: "skipped",
            reason: "reusable cache disabled by configuration",
          },
          { name: "model_load", status: "running" },
          { name: "context_creation", status: "pending" },
        ],
      },
    };

    render(<ModelReadinessBanner phase="starting" snapshot={snapshot} error={null} />);

    expect(screen.getByText(/Loading model:/i)).toBeDefined();
    expect(screen.getByText("Loading model weights")).toBeDefined();

    const detailsButton = screen.getByRole("button", { name: /details/i });
    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(detailsButton);
    expect(detailsButton.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByText("Validating configuration")).toBeDefined();
    expect(screen.getByText("12 ms")).toBeDefined();
    expect(screen.getByText("Reusable session cache")).toBeDefined();
    expect(screen.getByText("(reusable cache disabled by configuration)")).toBeDefined();
    expect(screen.getByText("Creating inference context")).toBeDefined();
  });

  it("renders failed state with error and retry button", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const snapshot: ProviderReadinessSnapshot = {
      status: "failed",
      retryable: false,
      details: {
        stages: [
          { name: "device_selection", status: "failed", reason: "GPU selection failed" },
        ],
      },
    };

    render(
      <ModelReadinessBanner
        phase="failed"
        snapshot={snapshot}
        error="GPU selection failed"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText("Model unavailable")).toBeDefined();
    expect(screen.getByText("GPU selection failed")).toBeDefined();

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
