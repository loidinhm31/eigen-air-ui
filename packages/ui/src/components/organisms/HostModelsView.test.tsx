// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HostModelsView } from "./HostModelsView.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

const initialStoreState = useInferenceStore.getState();

afterEach(() => {
  cleanup();
  useInferenceStore.setState(initialStoreState, true);
});

describe("HostModelsView", () => {
  it("renders recommendations, handles load, multi-deploy, and active operations", async () => {
    const user = userEvent.setup();

    const fetchHostModelsMock = vi.fn().mockResolvedValue(undefined);
    const fetchHostOperationsMock = vi.fn().mockResolvedValue(undefined);
    const dispatchModelOperationMock = vi.fn().mockResolvedValue("op-dispatch-123");
    const cancelOperationMock = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      hosts: {
        "host-gpu-1": {
          host_id: "host-gpu-1",
          installation_id: "inst-1",
          label: "GPU Node 1",
          platform: "linux_x86_64",
          agent_version: "1.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          recovery: {
            desired_revision: 1,
            reconciled_revision: 1,
            auto_load_model: false,
            auto_prepare_kv: false,
            model_ready: true,
            cache_ready: true,
            model_action: "none",
            cache_action: "none",
          },
          current_binding: null,
        },
        "host-gpu-2": {
          host_id: "host-gpu-2",
          installation_id: "inst-2",
          label: "GPU Node 2",
          platform: "linux_x86_64",
          agent_version: "1.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          recovery: {
            desired_revision: 1,
            reconciled_revision: 1,
            auto_load_model: false,
            auto_prepare_kv: false,
            model_ready: true,
            cache_ready: true,
            model_action: "none",
            cache_action: "none",
          },
          current_binding: null,
        },
      },
      hostModels: {
        "host-gpu-1": [
          {
            host_id: "host-gpu-1",
            artifact_id: "gemma-2-9b-it",
            fit: "fits",
            suggested_profile: {
              backend: "cuda",
              device_label: "RTX 4090",
              context_tokens: 8192,
              gpu_layers: 33,
              kv_placement: "vram",
              flash_attention: true,
            },
            qualification: "qualified",
            perf: {
              prefill_tokens_per_second: 320.5,
              decode_tokens_per_second: 54.2,
              source: "qualification_receipt",
            },
            risks: [
              {
                code: "CTX_HIGH",
                message: "High context token allocation near VRAM ceiling",
                severity: "warning",
              },
            ],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
          {
            host_id: "host-gpu-1",
            artifact_id: "llama-3-70b",
            fit: "does_not_fit",
            suggested_profile: null,
            qualification: "blocked",
            perf: {
              prefill_tokens_per_second: null,
              decode_tokens_per_second: null,
              source: "not_measured_yet",
            },
            risks: [
              {
                code: "INSUFFICIENT_VRAM",
                message: "Required VRAM exceeds physical card memory",
                severity: "critical",
              },
            ],
            rank: 2,
            selectable: false,
            disabled_reason: "Insufficient VRAM (requires 40GB)",
          },
        ],
      },
      hostOperations: {
        "host-gpu-1": [
          {
            operation_id: "op-active-1",
            host_id: "host-gpu-1",
            artifact_id: "gemma-2-9b-it",
            kind: "load",
            state: "running",
            stage: "load_context",
            revision: 2,
            started_at_ms: Date.now() - 10000,
            updated_at_ms: Date.now(),
            counters: {
              completed_units: 500,
              total_units: 1000,
              unit: "tokens",
              tokens_per_second: 45.0,
            },
          },
        ],
      },
      fetchHostModels: fetchHostModelsMock,
      fetchHostOperations: fetchHostOperationsMock,
      dispatchModelOperation: dispatchModelOperationMock,
      cancelOperation: cancelOperationMock,
    });

    render(<HostModelsView hostId="host-gpu-1" />);

    // Verify fetches called
    expect(fetchHostModelsMock).toHaveBeenCalledWith("host-gpu-1");
    expect(fetchHostOperationsMock).toHaveBeenCalledWith("host-gpu-1");

    // Verify active operation card with token unit formatting
    const opRegion = screen.getByTestId("active-operations-region");
    expect(opRegion).toBeTruthy();
    expect(screen.getByTestId("operation-progress-op-active-1")).toBeTruthy();
    expect(screen.getByTestId("operation-state-op-active-1").textContent).toContain("running");
    expect(screen.getByText(/500 tokens \/ 1,000 tokens/)).toBeTruthy();

    // Test cancel operation
    const cancelOpBtn = screen.getByTestId("cancel-operation-op-active-1");
    await user.click(cancelOpBtn);
    expect(cancelOperationMock).toHaveBeenCalledWith("op-active-1");

    // Verify Top-Ranked recommendation
    expect(screen.getByTestId("top-ranked-badge").textContent).toContain("Top Recommended (#1)");
    expect(screen.getByTestId("fit-badge-gemma-2-9b-it").textContent).toContain("Fits");
    expect(screen.getByTestId("qual-badge-gemma-2-9b-it").textContent).toContain("Qualified");

    // Verify suggested profile chips
    expect(screen.getByText("8192 ctx")).toBeTruthy();
    expect(screen.getByText("cuda")).toBeTruthy();
    expect(screen.getByText("RTX 4090")).toBeTruthy();
    expect(screen.getByText("33 layers")).toBeTruthy();
    expect(screen.getByText("Flash Attn")).toBeTruthy();

    // Verify measured performance & provenance
    expect(screen.getByText(/320.5 tok\/s/)).toBeTruthy();
    expect(screen.getByText(/54.2 tok\/s/)).toBeTruthy();
    expect(screen.getByText("src: qualification receipt")).toBeTruthy();

    // Verify risk chips
    expect(screen.getByTestId("risk-chip-CTX_HIGH")).toBeTruthy();

    // Verify Load button enabled for selectable recommendation
    const loadBtn = screen.getByTestId("load-btn-gemma-2-9b-it") as HTMLButtonElement;
    expect(loadBtn.disabled).toBe(false);
    await user.click(loadBtn);
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-gpu-1", "gemma-2-9b-it", { kind: "load" });

    // Verify disabled Load button and disabled_reason for blocked recommendation
    const blockedLoadBtn = screen.getByTestId("load-btn-llama-3-70b") as HTMLButtonElement;
    expect(blockedLoadBtn.disabled).toBe(true);
    const disabledReasonEl = screen.getByTestId("disabled-reason-llama-3-70b");
    expect(disabledReasonEl.textContent).toContain("Insufficient VRAM (requires 40GB)");

    // Test Multi-Host Deploy flow
    const multiDeployBtn = screen.getByTestId("multi-deploy-btn-gemma-2-9b-it");
    await user.click(multiDeployBtn);

    const deployPanel = screen.getByTestId("multi-deploy-panel");
    expect(deployPanel).toBeTruthy();

    // Select second host as target
    const host2Checkbox = screen.getByTestId("checkbox-host-host-gpu-2");
    await user.click(host2Checkbox);

    // Execute multi-deploy
    const executeMultiDeployBtn = screen.getByTestId("execute-multi-deploy-btn");
    await user.click(executeMultiDeployBtn);

    // Check independent dispatch was called for selected host
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-gpu-2", "gemma-2-9b-it", { kind: "load" });

    // Check outcome rendered
    const outcomeEl = screen.getByTestId("outcome-host-gpu-2");
    expect(outcomeEl.textContent).toContain("Operation dispatched");
  });

  it("surfaces load and cancel rejection errors to the user", async () => {
    const user = userEvent.setup();
    const dispatchModelOperationMock = vi.fn().mockRejectedValue(new Error("Host daemon out of memory"));
    const cancelOperationMock = vi.fn().mockRejectedValue(new Error("Operation not cancellable in current stage"));

    useInferenceStore.setState({
      hosts: {
        "host-1": {
          host_id: "host-1",
          installation_id: "inst-1",
          label: "Node 1",
          platform: "linux_x86_64",
          agent_version: "1.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          recovery: {
            desired_revision: 1,
            reconciled_revision: 1,
            auto_load_model: false,
            auto_prepare_kv: false,
            model_ready: false,
            cache_ready: false,
            model_action: "none",
            cache_action: "none",
          },
          current_binding: null,
        },
      },
      hostModels: {
        "host-1": [
          {
            host_id: "host-1",
            artifact_id: "gemma-2b",
            fit: "fits",
            suggested_profile: null,
            qualification: "qualified",
            perf: { source: "not_measured_yet" },
            risks: [],
            rank: 1,
            selectable: true,
          },
        ],
      },
      hostOperations: {
        "host-1": [
          {
            operation_id: "op-failed-cancel",
            host_id: "host-1",
            artifact_id: "gemma-2b",
            kind: "load",
            state: "running",
            revision: 1,
            counters: {},
          },
        ],
      },
      dispatchModelOperation: dispatchModelOperationMock,
      cancelOperation: cancelOperationMock,
    });

    render(<HostModelsView hostId="host-1" />);

    // Test load rejection
    const loadBtn = screen.getByTestId("load-btn-gemma-2b");
    await user.click(loadBtn);

    const errorBanner = screen.getByTestId("host-models-error");
    expect(errorBanner).toBeTruthy();
    expect(errorBanner.textContent).toContain("Host daemon out of memory");

    // Test cancel rejection
    const cancelBtn = screen.getByTestId("cancel-operation-op-failed-cancel");
    await user.click(cancelBtn);
    expect(screen.getByTestId("host-models-error").textContent).toContain("Operation not cancellable in current stage");
  });
});
