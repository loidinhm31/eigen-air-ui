// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionTargetSelector } from "./ExecutionTargetSelector.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

afterEach(() => {
  cleanup();
});

describe("ExecutionTargetSelector", () => {
  it("renders Server by default and paired active devices", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    useInferenceStore.setState({
      devices: [
        {
          device_id: "dev-laptop-1",
          display_label: "MacBook Pro",
          status: "active",
          warning_archived: false,
          protocol_min_version: "1.0",
          protocol_max_version: "1.0",
          runtime_metadata: {},
          created_at: 100,
          updated_at: 200,
          revision: 1,
        },
        {
          device_id: "dev-revoked",
          display_label: "Old Rig",
          status: "revoked",
          warning_archived: false,
          protocol_min_version: "1.0",
          protocol_max_version: "1.0",
          runtime_metadata: {},
          created_at: 100,
          updated_at: 200,
          revision: 1,
        },
      ],
    });

    render(<ExecutionTargetSelector onChange={onChange} />);

    expect(screen.getByText("Server")).toBeTruthy();
    expect(screen.getByText("MacBook Pro")).toBeTruthy();
    // Revoked device should not be selectable
    expect(screen.queryByText("Old Rig")).toBeNull();

    await user.click(screen.getByText("MacBook Pro"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "client_device",
      device_id: "dev-laptop-1",
      model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
    });

    await user.click(screen.getByText("Server"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "server",
    });
  });

  it("renders pool targets and selects logical pool", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    useInferenceStore.setState({
      pools: {
        default: {
          pool_id: "default",
          ready_hosts: 2,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl", "qwen-3.8-27b-ud-q4_k_xl"],
        },
      },
      devices: [],
    });

    render(<ExecutionTargetSelector onChange={onChange} />);

    expect(screen.getByText("Pool: default")).toBeTruthy();
    expect(screen.getByText("2 Ready")).toBeTruthy();

    await user.click(screen.getByText("Pool: default"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "pool",
      pool_id: "default",
      model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
      model_digest: "df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3",
    });
  });

  it("renders model options when pool target is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    useInferenceStore.setState({
      pools: {
        default: {
          pool_id: "default",
          ready_hosts: 2,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl", "qwen-3.8-27b-ud-q4_k_xl"],
        },
      },
      devices: [],
    });

    render(
      <ExecutionTargetSelector
        value={{
          kind: "pool",
          pool_id: "default",
          model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        }}
        onChange={onChange}
      />
    );

    expect(screen.getByText("Pool Model:")).toBeTruthy();
    const qwenBtn = screen.getByRole("button", { name: "qwen-3.8-27b-ud-q4_k_xl" });
    await user.click(qwenBtn);

    expect(onChange).toHaveBeenCalledWith({
      kind: "pool",
      pool_id: "default",
      model_artifact_id: "qwen-3.8-27b-ud-q4_k_xl",
      model_digest: "3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e",
    });
  });
});
