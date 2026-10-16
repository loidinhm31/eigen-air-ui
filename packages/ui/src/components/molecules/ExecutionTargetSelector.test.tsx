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
});
