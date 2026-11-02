// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InferenceSettings } from "./InferenceSettings.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

afterEach(() => {
  cleanup();
});

describe("InferenceSettings", () => {
  it("renders Server and Companion tabs, handles license acceptance, and displays operations", async () => {
    const user = userEvent.setup();

    const mockDownload = vi.fn().mockResolvedValue({
      operation_id: "op-1",
      artifact_id: "gemma-4",
      execution_target_kind: "server",
      stage: "download",
      status: "active",
      revision: 1,
      started_at_ms: 100,
      updated_at_ms: 200,
      counters: { completed_units: 1000, total_units: 2000, bytes_per_second: 1024 * 1024 },
    });

    useInferenceStore.setState({
      serverModels: [
        {
          artifact_id: "gemma-4",
          family: "gemma",
          display_name: "Gemma 4 IT",
          quantization: "UD-Q4_K_XL",
          installed: false,
          is_loaded: false,
          has_kv_cache: false,
        },
      ],
      serverRoots: [
        {
          root_id: "root-1",
          kind: "model_root",
          display_label: "Default SSD",
          total_bytes: 100_000_000_000,
          available_bytes: 50_000_000_000,
          is_removable: false,
          is_read_only: false,
        },
      ],
      devices: [
        {
          device_id: "dev-mac",
          display_label: "Office Mac",
          status: "active",
          warning_archived: false,
          protocol_min_version: "1.0",
          protocol_max_version: "1.0",
          runtime_metadata: {},
          created_at: 100,
          updated_at: 200,
          revision: 1,
        },
      ],
      companionStatus: {
        version: "1.0.0",
        status: "ready",
        active_root: "root-1",
        queued_requests: 0,
        model_loaded: false,
      },
      operations: {
        "op-active": {
          operation_id: "op-active",
          artifact_id: "qwen-3.8-27b",
          execution_target_kind: "server",
          stage: "download",
          status: "active",
          revision: 2,
          started_at_ms: 100,
          updated_at_ms: 200,
          counters: {
            completed_units: 500 * 1024 * 1024,
            total_units: 1000 * 1024 * 1024,
            bytes_per_second: 25 * 1024 * 1024,
            estimated_remaining_seconds: 20,
          },
        },
      },
      downloadServerModel: mockDownload,
      fetchAll: vi.fn().mockResolvedValue(undefined),
    });

    render(<InferenceSettings />);

    // Active operations card should render measured progress
    expect(screen.getByText("Active Model Operations")).toBeTruthy();
    expect(screen.getByText("qwen-3.8-27b")).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/25.0 MB\/s/)).toBeTruthy();

    // Server tab: Gemma 4 is present with Download button
    expect(screen.getByText("Gemma 4 IT")).toBeTruthy();
    const downloadBtn = screen.getByRole("button", { name: "Download" });
    await user.click(downloadBtn);

    // License acceptance prompt appears
    expect(screen.getByText(/Accept License Terms/)).toBeTruthy();
    const acceptBtn = screen.getByRole("button", { name: "Accept & Download" });
    await user.click(acceptBtn);
    expect(mockDownload).toHaveBeenCalledWith("gemma-4");

    // Switch to Companion tab
    const companionTab = screen.getByRole("button", { name: "Companion" });
    await user.click(companionTab);

    // Companion device view is shown
    expect(screen.getByText("Local Desktop Companion")).toBeTruthy();
    expect(screen.getByText("Office Mac")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpair Local" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retire" })).toBeTruthy();
  });

  it("renders and switches to Hosts, Pools, and Recommendations tabs", async () => {
    const user = userEvent.setup();
    useInferenceStore.setState({
      hosts: {},
      pools: {},
      credentialRecoveries: {},
      hostModels: {},
      hostOperations: {},
    });

    render(<InferenceSettings />);

    // Switch to Hosts tab
    const hostsTab = screen.getByTestId("tab-hosts");
    await user.click(hostsTab);
    expect(screen.getByTestId("inference-hosts-view")).toBeTruthy();

    // Switch to Pools tab
    const poolsTab = screen.getByTestId("tab-pools");
    await user.click(poolsTab);
    expect(screen.getByTestId("inference-pools-view")).toBeTruthy();

    // Switch to Recommendations tab
    const modelsTab = screen.getByTestId("tab-models");
    await user.click(modelsTab);
    expect(screen.getByTestId("host-models-view")).toBeTruthy();
  });
  it("UI-05: bounds polling interval only when active operations are present and cleans up on unmount", async () => {
    vi.useFakeTimers();
    const fetchAllSpy = vi.fn().mockResolvedValue(undefined);
    useInferenceStore.setState({
      fetchAll: fetchAllSpy,
      operations: {
        "op-active": {
          operation_id: "op-active",
          artifact_id: "gemma-4",
          execution_target_kind: "server",
          stage: "download",
          status: "active",
          revision: 1,
          started_at_ms: 100,
          updated_at_ms: 200,
          counters: {},
        },
      },
    });

    const { unmount } = render(<InferenceSettings />);
    // Initial fetchAll on mount
    expect(fetchAllSpy).toHaveBeenCalledTimes(1);

    // Fast-forward 1000ms: interval ticks once
    vi.advanceTimersByTime(1000);
    expect(fetchAllSpy).toHaveBeenCalledTimes(2);

    // Unmount clears interval
    unmount();
    vi.advanceTimersByTime(2000);
    expect(fetchAllSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
