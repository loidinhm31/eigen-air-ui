// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InferencePoolsView } from "./InferencePoolsView.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";
const initialStoreState = useInferenceStore.getState();

afterEach(() => {
  cleanup();
  useInferenceStore.setState(initialStoreState, true);
});
describe("InferencePoolsView", () => {
  it("renders pools with readiness counts, qualified models, and bound vs draining hosts", async () => {
    const user = userEvent.setup();
    const fetchPoolsMock = vi.fn().mockResolvedValue(undefined);
    const fetchHostsMock = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      pools: {
        "prod-inference": {
          pool_id: "prod-inference",
          ready_hosts: 2,
          busy_hosts: 1,
          offline_hosts: 0,
          qualified_models: ["gemma-2-9b-it", "qwen-2.5-7b"],
        },
      },
      hosts: {
        "host-1": {
          host_id: "host-1",
          installation_id: "inst-1",
          label: "GPU Node Alpha",
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
          current_binding: {
            host_id: "host-1",
            pool_id: "prod-inference",
            revision: 1,
            state: "bound",
            changed_at_ms: Date.now(),
          },
        },
        "host-2": {
          host_id: "host-2",
          installation_id: "inst-2",
          label: "GPU Node Beta",
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
          current_binding: {
            host_id: "host-2",
            pool_id: "prod-inference",
            revision: 2,
            state: "draining",
            changed_at_ms: Date.now(),
          },
        },
      },
      loadingPools: false,
      fetchPools: fetchPoolsMock,
      fetchHosts: fetchHostsMock,
    });

    render(<InferencePoolsView />);

    expect(fetchPoolsMock).toHaveBeenCalled();
    expect(fetchHostsMock).toHaveBeenCalled();

    // Verify pool card
    expect(screen.getByTestId("pool-card-prod-inference")).toBeTruthy();
    expect(screen.getByTestId("ready-hosts-prod-inference").textContent).toContain("2 Ready");
    expect(screen.getByTestId("busy-hosts-prod-inference").textContent).toContain("1 Busy");
    expect(screen.getByTestId("offline-hosts-prod-inference").textContent).toContain("0 Offline");

    // Verify qualified models
    const qualifiedSection = screen.getByTestId("qualified-models-prod-inference");
    expect(qualifiedSection.textContent).toContain("gemma-2-9b-it");
    expect(qualifiedSection.textContent).toContain("qwen-2.5-7b");

    // Verify bound member host
    const boundHost = screen.getByTestId("member-host-host-1");
    expect(boundHost.textContent).toContain("GPU Node Alpha");
    expect(boundHost.textContent).toContain("Online");

    // Verify draining host is separated
    const drainingHost = screen.getByTestId("draining-host-host-2");
    expect(drainingHost.textContent).toContain("GPU Node Beta");
    expect(drainingHost.textContent).toContain("Draining");

    // Click refresh button
    const refreshBtn = screen.getByTestId("refresh-pools-button");
    await user.click(refreshBtn);
    expect(fetchPoolsMock).toHaveBeenCalledTimes(2);
  });
});
