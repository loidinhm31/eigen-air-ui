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

    let testHostModels: Record<string, any[]> = {};
    const fetchHostModelsMock = vi.fn().mockImplementation((id: string) => Promise.resolve(testHostModels[id] || []));
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
      hostModels: (testHostModels = {
        "host-gpu-1": [
          {
            host_id: "host-gpu-1",
            artifact_id: "gemma-2-9b-it",
            fit: "fits" as const,
            suggested_profile: {
              backend: "cuda",
              device_label: "RTX 4090",
              context_tokens: 8192,
              gpu_layers: 33,
              kv_placement: "vram",
              flash_attention: true,
              profile: {
                context_tokens: 8192,
                gpu_layers: 33,
                batch_tokens: 512,
                flash_attention: true,
                ubatch_tokens: 512,
                threads: 4,
                kv_placement: "vram",
                type_k: "f16",
                type_v: "f16",
              },
            },
            qualification: "qualified" as const,
            perf: {
              prefill_tokens_per_second: 320.5,
              decode_tokens_per_second: 54.2,
              source: "qualification_receipt",
            },
            risks: [
              {
                code: "CTX_HIGH",
                message: "High context token allocation near VRAM ceiling",
                severity: "warning" as const,
              },
            ],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
          {
            host_id: "host-gpu-1",
            artifact_id: "llama-3-70b",
            fit: "does_not_fit" as const,
            suggested_profile: null,
            qualification: "blocked" as const,
            perf: {
              prefill_tokens_per_second: null,
              decode_tokens_per_second: null,
              source: "not_measured_yet",
            },
            risks: [
              {
                code: "INSUFFICIENT_VRAM",
                message: "Required VRAM exceeds physical card memory",
                severity: "critical" as const,
              },
            ],
            rank: 2,
            selectable: false,
            disabled_reason: "Insufficient VRAM (requires 40GB)",
          },
        ],
        "host-gpu-2": [
          {
            host_id: "host-gpu-2",
            artifact_id: "gemma-2-9b-it",
            fit: "fits" as const,
            suggested_profile: {
              backend: "cuda",
              device_label: "RTX 4090",
              context_tokens: 8192,
              gpu_layers: 33,
              kv_placement: "vram",
              flash_attention: true,
              profile: {
                context_tokens: 8192,
                gpu_layers: 33,
                batch_tokens: 512,
                flash_attention: true,
                ubatch_tokens: 512,
                threads: 4,
                kv_placement: "vram",
                type_k: "f16",
                type_v: "f16",
              },
            },
            qualification: "qualified" as const,
            perf: {
              prefill_tokens_per_second: 320.5,
              decode_tokens_per_second: 54.2,
              source: "qualification_receipt",
            },
            risks: [],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
        ],
      }),
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
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-gpu-1", "gemma-2-9b-it", {
      kind: "load",
      profile: {
        context_tokens: 8192,
        gpu_layers: 33,
        batch_tokens: 512,
        flash_attention: true,
        ubatch_tokens: 512,
        threads: 4,
        kv_placement: "vram",
        type_k: "f16",
        type_v: "f16",
      },
    });

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

    // Check independent dispatch was called for selected host with concrete profile
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-gpu-2", "gemma-2-9b-it", {
      kind: "load",
      profile: {
        context_tokens: 8192,
        gpu_layers: 33,
        batch_tokens: 512,
        flash_attention: true,
        ubatch_tokens: 512,
        threads: 4,
        kv_placement: "vram",
        type_k: "f16",
        type_v: "f16",
      },
    });
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
            suggested_profile: {
              backend: "cpu",
              context_tokens: 2048,
              gpu_layers: 0,
              kv_placement: "ram",
              flash_attention: false,
              profile: {
                context_tokens: 2048,
                gpu_layers: 0,
                batch_tokens: 128,
                flash_attention: false,
                ubatch_tokens: 128,
                threads: 2,
                kv_placement: "ram",
                type_k: "f16",
                type_v: "f16",
              },
            },
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
      fetchHostModels: vi.fn().mockImplementation(() =>
        Promise.resolve([
          {
            host_id: "host-1",
            artifact_id: "gemma-2b",
            fit: "fits",
            suggested_profile: {
              backend: "cpu",
              context_tokens: 2048,
              gpu_layers: 0,
              kv_placement: "ram",
              flash_attention: false,
              profile: {
                context_tokens: 2048,
                gpu_layers: 0,
                batch_tokens: 128,
                flash_attention: false,
                ubatch_tokens: 128,
                threads: 2,
                kv_placement: "ram",
                type_k: "f16",
                type_v: "f16",
              },
            },
            qualification: "qualified",
            perf: { source: "not_measured_yet" },
            risks: [],
            rank: 1,
            selectable: true,
          },
        ])
      ),
      fetchHostOperations: vi.fn().mockResolvedValue([]),
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

  it("UI-02: displays completed, failed, and indeterminate terminal operation evidence", () => {
    useInferenceStore.setState({
      hosts: {
        "host-term": {
          host_id: "host-term",
          installation_id: "inst-1",
          label: "Terminal Host",
          platform: "linux_x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
        },
      },
      hostModels: {
        "host-term": [],
      },
      hostOperations: {
        "host-term": [
          {
            operation_id: "op-completed",
            host_id: "host-term",
            artifact_id: "gemma-4",
            kind: "load",
            state: "completed",
            revision: 5,
            started_at_ms: Date.now() - 5000,
            completed_at_ms: Date.now(),
            counters: {},
          },
          {
            operation_id: "op-indeterminate",
            host_id: "host-term",
            artifact_id: "qwen-3.5",
            kind: "prepare_kv",
            state: "indeterminate",
            revision: 3,
            started_at_ms: Date.now() - 10000,
            completed_at_ms: Date.now() - 2000,
            counters: {},
          },
        ],
      },
      fetchHostModels: vi.fn().mockResolvedValue([]),
      fetchHostOperations: vi.fn().mockResolvedValue([]),
    });

    render(<HostModelsView hostId="host-term" />);

    // Both terminal operations are visible in the operations region
    expect(screen.getByTestId("active-operations-region")).toBeTruthy();
    expect(screen.getByTestId("operation-progress-op-completed")).toBeTruthy();
    expect(screen.getByTestId("operation-state-op-completed").textContent).toContain("completed");
    expect(screen.getByTestId("operation-progress-op-indeterminate")).toBeTruthy();
    expect(screen.getByTestId("operation-state-op-indeterminate").textContent).toContain("indeterminate");

    // Terminal operations do not render Cancel buttons
    expect(screen.queryByTestId("cancel-operation-op-completed")).toBeNull();
    expect(screen.queryByTestId("cancel-operation-op-indeterminate")).toBeNull();
  });

  it("allows dismissing individual terminal operations and clearing all finished operations", async () => {
    const user = userEvent.setup();
    useInferenceStore.setState({
      hosts: {
        "host-term": {
          host_id: "host-term",
          installation_id: "inst-1",
          label: "Term Host",
          platform: "linux_x86_64",
          agent_version: "0.2.0",
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          lifecycle_revision: 1,
          applied_binding_revision: 0,
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
        },
      },
      hostModels: {
        "host-term": [],
      },
      hostOperations: {
        "host-term": [
          {
            operation_id: "op-failed-1",
            host_id: "host-term",
            artifact_id: "gemma-4",
            kind: "download",
            state: "failed",
            revision: 2,
            started_at_ms: Date.now() - 5000,
            completed_at_ms: Date.now(),
            counters: {},
            error_message: "Host operation failed",
          },
          {
            operation_id: "op-completed-1",
            host_id: "host-term",
            artifact_id: "qwen-3.5",
            kind: "purge",
            state: "completed",
            revision: 3,
            started_at_ms: Date.now() - 10000,
            completed_at_ms: Date.now() - 2000,
            counters: {},
          },
        ],
      },
      dismissedOperations: {},
      fetchHostModels: vi.fn().mockResolvedValue([]),
      fetchHostOperations: vi.fn().mockResolvedValue([]),
    });

    render(<HostModelsView hostId="host-term" />);

    // Both operations visible
    expect(screen.getByTestId("operation-progress-op-failed-1")).toBeTruthy();
    expect(screen.getByTestId("operation-progress-op-completed-1")).toBeTruthy();

    // Dismiss individual card
    const dismissFailedBtn = screen.getByTestId("dismiss-operation-op-failed-1");
    await user.click(dismissFailedBtn);

    // Failed operation is dismissed and hidden
    expect(screen.queryByTestId("operation-progress-op-failed-1")).toBeNull();
    expect(screen.getByTestId("operation-progress-op-completed-1")).toBeTruthy();

    // Clear finished button dismisses remaining finished operations
    const clearFinishedBtn = screen.getByTestId("clear-finished-operations-button");
    await user.click(clearFinishedBtn);

    expect(screen.queryByTestId("operation-progress-op-completed-1")).toBeNull();
    expect(screen.queryByTestId("active-operations-region")).toBeNull();
  });

  it("UI-06: fresh recommendations govern multi-deploy dispatch and failed refresh never authorizes from stale cache", async () => {
    const user = userEvent.setup();
    const dispatchModelOperationMock = vi.fn().mockResolvedValue("op-multi-fresh-1");

    // Host-1 cached as selectable, Host-2 cached as non-selectable, Host-3 cached as selectable
    const initialHostModels = {
      "host-1": [
        {
          host_id: "host-1",
          artifact_id: "gemma-4",
          fit: "fits" as const,
          suggested_profile: {
            backend: "cpu",
            context_tokens: 4096,
            gpu_layers: 0,
            kv_placement: "ram",
            flash_attention: false,
            profile: {
              context_tokens: 4096,
              gpu_layers: 0,
              batch_tokens: 256,
              flash_attention: false,
              ubatch_tokens: 256,
              threads: 4,
              kv_placement: "ram",
              type_k: "f16",
              type_v: "f16",
            },
          },
          qualification: "qualified" as const,
          perf: { source: "receipt" },
          risks: [],
          rank: 1,
          selectable: true,
          disabled_reason: null,
        },
      ],
      "host-2": [
        {
          host_id: "host-2",
          artifact_id: "gemma-4",
          fit: "does_not_fit" as const,
          suggested_profile: null,
          qualification: "unqualified" as const,
          perf: { source: "none" },
          risks: [],
          rank: 2,
          selectable: false,
          disabled_reason: "Insufficient RAM",
        },
      ],
      "host-fail": [
        {
          host_id: "host-fail",
          artifact_id: "gemma-4",
          fit: "fits" as const,
          suggested_profile: {
            backend: "cpu",
            context_tokens: 4096,
            gpu_layers: 0,
            kv_placement: "ram",
            flash_attention: false,
            profile: {
              context_tokens: 4096,
              gpu_layers: 0,
              batch_tokens: 256,
              flash_attention: false,
              ubatch_tokens: 256,
              threads: 4,
              kv_placement: "ram",
              type_k: "f16",
              type_v: "f16",
            },
          },
          qualification: "qualified" as const,
          perf: { source: "receipt" },
          risks: [],
          rank: 3,
          selectable: true,
          disabled_reason: null,
        },
      ],
    };

    // Fresh fetch returns true-to-false for host-1, false-to-true for host-2
    const fetchHostModelsMock = vi.fn().mockImplementation((hostId: string) => {
      if (hostId === "host-1") {
        // Changed: now ineligible
        return Promise.resolve([
          {
            host_id: "host-1",
            artifact_id: "gemma-4",
            fit: "does_not_fit" as const,
            suggested_profile: null,
            qualification: "blocked" as const,
            risks: [],
            rank: 1,
            selectable: false,
            disabled_reason: "Resource pressure spike",
          },
        ]);
      }
      if (hostId === "host-2") {
        // Changed: now eligible with new profile
        return Promise.resolve([
          {
            host_id: "host-2",
            artifact_id: "gemma-4",
            fit: "fits" as const,
            suggested_profile: {
              backend: "cpu",
              context_tokens: 2048,
              gpu_layers: 0,
              kv_placement: "ram",
              flash_attention: false,
              profile: {
                context_tokens: 2048,
                gpu_layers: 0,
                batch_tokens: 128,
                flash_attention: false,
                ubatch_tokens: 128,
                threads: 2,
                kv_placement: "ram",
                type_k: "f16",
                type_v: "f16",
              },
            },
            qualification: "qualified" as const,
            perf: { source: "receipt" },
            risks: [],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
        ]);
      }
      return Promise.reject(new Error("Network timeout refreshing host"));
    });

    useInferenceStore.setState({
      hosts: {
        "host-1": {
          host_id: "host-1",
          installation_id: "inst-1",
          label: "Host 1",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
        "host-2": {
          host_id: "host-2",
          installation_id: "inst-2",
          label: "Host 2",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
        "host-fail": {
          host_id: "host-fail",
          installation_id: "inst-3",
          label: "Host Fail",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
      hostModels: initialHostModels,
      hostOperations: {},
      fetchHostModels: fetchHostModelsMock,
      fetchHostOperations: vi.fn().mockResolvedValue([]),
      dispatchModelOperation: dispatchModelOperationMock,
    });

    render(<HostModelsView hostId="host-1" />);

    // Open multi-deploy for gemma-4
    const multiDeployBtn = screen.getByTestId("multi-deploy-btn-gemma-4");
    await user.click(multiDeployBtn);

    // Select host-1 and host-2
    await user.click(screen.getByTestId("checkbox-host-host-1"));
    await user.click(screen.getByTestId("checkbox-host-host-2"));
    await user.click(screen.getByTestId("checkbox-host-host-fail"));
    // Execute deployment
    await user.click(screen.getByTestId("execute-multi-deploy-btn"));

    // Host-1 (fresh false) should report ineligible with fresh reason
    const outcome1 = screen.getByTestId("outcome-host-1");
    expect(outcome1.textContent).toContain("Resource pressure spike");

    // Host-2 (fresh true) should dispatch with fresh profile
    const outcome2 = screen.getByTestId("outcome-host-2");
    expect(outcome2.textContent).toContain("Operation dispatched");
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-2", "gemma-4", {
      kind: "load",
      profile: {
        context_tokens: 2048,
        gpu_layers: 0,
        batch_tokens: 128,
        flash_attention: false,
        ubatch_tokens: 128,
        threads: 2,
        kv_placement: "ram",
        type_k: "f16",
        type_v: "f16",
      },
    });
    // Host-fail (refresh failed) should report ineligible and refuse dispatch
    const outcomeFail = screen.getByTestId("outcome-host-fail");
    expect(outcomeFail.textContent).toContain("Failed to refresh recommendations for host");
  });

  it("UI-06: single-host handleLoad refreshes recommendations and refuses dispatch if refresh fails", async () => {
    const user = userEvent.setup();
    const dispatchModelOperationMock = vi.fn().mockResolvedValue("op-load-1");
    const fetchHostModelsMock = vi.fn().mockRejectedValue(new Error("Network timeout"));

    useInferenceStore.setState({
      hosts: {
        "host-load-refresh": {
          host_id: "host-load-refresh",
          installation_id: "inst-1",
          label: "Load Refresh Host",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
        "host-load-refresh": [
          {
            host_id: "host-load-refresh",
            artifact_id: "gemma-4",
            fit: "fits" as const,
            suggested_profile: {
              backend: "cpu",
              context_tokens: 4096,
              gpu_layers: 0,
              kv_placement: "ram",
              flash_attention: false,
              profile: {
                context_tokens: 4096,
                gpu_layers: 0,
                batch_tokens: 256,
                flash_attention: false,
                ubatch_tokens: 256,
                threads: 4,
                kv_placement: "ram",
                type_k: "f16",
                type_v: "f16",
              },
            },
            qualification: "qualified" as const,
            perf: { source: "receipt" },
            risks: [],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
        ],
      },
      hostOperations: {},
      fetchHostModels: fetchHostModelsMock,
      fetchHostOperations: vi.fn().mockResolvedValue([]),
      dispatchModelOperation: dispatchModelOperationMock,
    });

    render(<HostModelsView hostId="host-load-refresh" />);

    // Click Load Model
    const loadBtn = screen.getByTestId("load-btn-gemma-4");
    await user.click(loadBtn);

    // Refresh was attempted
    expect(fetchHostModelsMock).toHaveBeenCalledWith("host-load-refresh");
    // Dispatch was refused because refresh failed
    expect(dispatchModelOperationMock).not.toHaveBeenCalled();
    // Error banner displayed to user
    const errorBanner = screen.getByTestId("host-models-error");
    expect(errorBanner.textContent).toContain(
      "Failed to refresh recommendations for host; cannot authorize dispatch from stale cache"
    );
  });

  it("UI-09: renders chosen-host lifecycle controls (download with license, unload, prepare_kv, purge cache)", async () => {
    const user = userEvent.setup();
    const dispatchModelOperationMock = vi.fn().mockResolvedValue("op-lifecycle-1");
    const purgeHostCacheMock = vi.fn().mockResolvedValue({ status: "pending_purge" });

    useInferenceStore.setState({
      hosts: {
        "host-lc": {
          host_id: "host-lc",
          installation_id: "inst-1",
          label: "Lifecycle Host",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
        "host-lc": [
          {
            host_id: "host-lc",
            artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
            fit: "fits" as const,
            suggested_profile: null,
            qualification: "qualified" as const,
            perf: { source: "receipt" },
            risks: [],
            rank: 1,
            selectable: true,
            disabled_reason: null,
          },
        ],
      },
      hostOperations: {},
      dispatchModelOperation: dispatchModelOperationMock,
      purgeHostCache: purgeHostCacheMock,
      fetchHostModels: vi.fn().mockResolvedValue([]),
      fetchHostOperations: vi.fn().mockResolvedValue([]),
    });

    render(<HostModelsView hostId="host-lc" />);

    // 1. Download button opens license prompt dialog and submits valid expected_sha256
    const downloadBtn = screen.getByTestId("download-btn-gemma-4-e4b-it-qat-ud-q4_k_xl");
    await user.click(downloadBtn);

    expect(screen.getByTestId("license-prompt-dialog")).toBeTruthy();
    expect(screen.getByText("Accept License Terms")).toBeTruthy();

    // Accept license terms
    const acceptBtn = screen.getByTestId("accept-license-download-btn");
    await user.click(acceptBtn);
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-lc", "gemma-4-e4b-it-qat-ud-q4_k_xl", {
      kind: "download",
      expected_sha256: "df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3",
      license_accepted: true,
    });

    // 2. Prepare KV button requires authorized session source_ref and explains requirement
    const prepareBtn = screen.getByTestId("prepare-btn-gemma-4-e4b-it-qat-ud-q4_k_xl");
    await user.click(prepareBtn);
    expect(screen.getByTestId("host-models-error").textContent).toContain(
      "Scoped cache preparation requires an authorized app session source"
    );

    // 3. Unload button dispatches unload
    const unloadBtn = screen.getByTestId("unload-btn-gemma-4-e4b-it-qat-ud-q4_k_xl");
    await user.click(unloadBtn);
    expect(dispatchModelOperationMock).toHaveBeenCalledWith("host-lc", "gemma-4-e4b-it-qat-ud-q4_k_xl", {
      kind: "unload",
    });

    // 4. Host cache purge requires explicit session_id
    const purgeBtn = screen.getByTestId("purge-cache-button");
    await user.click(purgeBtn);

    const sessionInput = screen.getByTestId("purge-session-scope-input");
    await user.type(sessionInput, "session-test-scope");

    const confirmPurgeBtn = screen.getByTestId("confirm-purge-cache-button");
    await user.click(confirmPurgeBtn);
    expect(purgeHostCacheMock).toHaveBeenCalledWith("host-lc", { session_id: "session-test-scope" });
  });

  it("UI-10/W3: renders unresolved ambiguous/unknown mutations with Retry button and calls retryPendingMutation", async () => {
    const user = userEvent.setup();
    const retryPendingMutationMock = vi.fn().mockResolvedValue("op-retried-1");

    useInferenceStore.setState({
      hosts: {
        "host-retry": {
          host_id: "host-retry",
          installation_id: "inst-1",
          label: "Retry Host",
          platform: "linux_x86_64",
          agent_version: "1.0.0",
          lifecycle_revision: 1,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
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
      hostModels: {},
      hostOperations: {},
      persistedMutations: {
        "mut-ambiguous-1": {
          mutationId: "mut-ambiguous-1",
          hostId: "host-retry",
          kind: "load",
          artifactId: "qwen-3.5",
          timestamp: Date.now() - 10000,
          status: "ambiguous",
          request: {
            kind: "load",
            artifact_id: "qwen-3.5",
            mutation_id: "mut-ambiguous-1",
          },
        },
      },
      retryPendingMutation: retryPendingMutationMock,
      fetchHostModels: vi.fn().mockResolvedValue([]),
      fetchHostOperations: vi.fn().mockResolvedValue([]),
    });

    render(<HostModelsView hostId="host-retry" />);

    // Unresolved operations region is rendered
    expect(screen.getByTestId("unresolved-mutations-region")).toBeTruthy();
    expect(screen.getByTestId("unresolved-mutation-mut-ambiguous-1")).toBeTruthy();
    expect(screen.getByText("qwen-3.5")).toBeTruthy();
    expect(screen.getByText("ambiguous")).toBeTruthy();

    // Retry button calls retryPendingMutation
    const retryBtn = screen.getByTestId("retry-mutation-mut-ambiguous-1");
    await user.click(retryBtn);
    expect(retryPendingMutationMock).toHaveBeenCalledWith("mut-ambiguous-1");
  });
});
