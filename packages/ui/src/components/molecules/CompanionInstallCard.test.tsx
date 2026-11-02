// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionInstallCard } from "./CompanionInstallCard.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useInferenceStore.getState().invalidateAccess();
});

describe("CompanionInstallCard", () => {
  it("renders browser execution boundary and qualified platforms", () => {
    render(<CompanionInstallCard />);

    expect(
      screen.getByText(/browser does not execute native model weights or in-browser WebGPU/i)
    ).toBeDefined();

    expect(screen.getByText("Linux (Ubuntu / Fedora)")).toBeDefined();
    expect(screen.getByText("Windows")).toBeDefined();
    expect(screen.getAllByText("Unqualified").length).toBe(4);
  });

  it("displays single token-free execution command", () => {
    render(<CompanionInstallCard />);

    // By default Ubuntu is selected, showing bash command
    const code = screen.getByText(/bash "\.\/install-eigen-air\.sh"/i);
    expect(code).toBeDefined();
    // The command itself contains NO tokens, hosts, or passwords
    expect(code.textContent).not.toMatch(/token|bearer|http/i);
  });

  it("switches to PowerShell command when Windows platform selected", async () => {
    const user = userEvent.setup();
    render(<CompanionInstallCard />);

    const windowsBtn = screen.getByRole("button", { name: /Windows/i });
    await user.click(windowsBtn);

    expect(
      screen.getByText(/powershell -ExecutionPolicy Bypass -File "\.\\install-eigen-air\.ps1"/i)
    ).toBeDefined();
  });

  it("renders tab closure isolation and prototype security notice", () => {
    render(<CompanionInstallCard />);

    expect(
      screen.getByText(/Closing or refreshing this browser tab does not terminate the running companion/i)
    ).toBeDefined();
    expect(
      screen.getByText(/Security Notice:/i)
    ).toBeDefined();
  });

  it("resumes and renders correlated connected host", () => {
    useInferenceStore.setState({
      activeInstallationId: "inst-999",
      hosts: {
        h1: {
          host_id: "h1",
          installation_id: "inst-999",
          label: "Remote 780M Host",
          platform: "ubuntu_x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: 1000,
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
          current_binding: null,
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
        other_host: {
          host_id: "other_host",
          installation_id: "inst-other",
          label: "Unrelated Host",
          platform: "fedora_x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: 1000,
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 0,
          current_binding: null,
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
    });

    render(<CompanionInstallCard />);

    // Shows matching correlated host
    expect(screen.getByText("Remote 780M Host")).toBeDefined();
    expect(screen.getByText("Connected (Unbound)")).toBeDefined();
    // Does NOT show unrelated host
    expect(screen.queryByText("Unrelated Host")).toBeNull();
  });

  it("UI-03: renders enrolled offline host honestly rather than connected", () => {
    useInferenceStore.setState({
      activeInstallationId: "inst-offline",
      hosts: {
        h_offline: {
          host_id: "h_offline",
          installation_id: "inst-offline",
          label: "Offline Remote Host",
          platform: "linux-x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: 1000,
          is_connected: false,
          lease_valid: false,
          applied_binding_revision: 0,
          current_binding: null,
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
    });

    render(<CompanionInstallCard />);

    expect(screen.getByText("Offline Remote Host")).toBeDefined();
    // Both header badge and host row badge must be labeled Enrolled (Offline), NOT Connected (Unbound)
    expect(screen.getAllByText("Enrolled (Offline)").length).toBe(2);
    expect(screen.queryByText("Connected (Unbound)")).toBeNull();
  });

  it("UI-03: consumes scalar installation projection before hosts are populated", () => {
    useInferenceStore.setState({
      activeInstallationId: "inst-early-conn",
      installations: {
        "inst-early-conn": {
          installation_id: "inst-early-conn",
          deployment_id: "dep-1",
          platform: "linux-x86_64",
          label: "Early Gateway Host",
          status: "connected",
          enrolled: true,
          connected: true,
          host_id: "host-early-1",
          created_at_ms: 1000,
          registered_hosts: ["host-early-1"],
          connected_hosts: ["host-early-1"],
          bound_hosts: [],
        },
      },
      hosts: {},
    });

    render(<CompanionInstallCard />);

    // Header shows Connected (1) from installation projection
    expect(screen.getByText("Connected (1)")).toBeDefined();
    expect(screen.getByText("Early Gateway Host")).toBeDefined();
  });

  it("UI-03: scalar disconnect takes precedence over stale connected host snapshot", () => {
    useInferenceStore.setState({
      activeInstallationId: "inst-disc-override",
      installations: {
        "inst-disc-override": {
          installation_id: "inst-disc-override",
          deployment_id: "dep-1",
          platform: "linux-x86_64",
          label: "Disconnected Host",
          status: "enrolled",
          enrolled: true,
          connected: false, // Scalar disconnect from gateway
          host_id: "host-disc",
          created_at_ms: 1000,
          registered_hosts: ["host-disc"],
          connected_hosts: [],
          bound_hosts: [],
        },
      },
      hosts: {
        "host-disc": {
          host_id: "host-disc",
          installation_id: "inst-disc-override",
          label: "Disconnected Host",
          platform: "linux-x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 1,
          last_seen_at_ms: 1000,
          is_connected: true, // Stale snapshot still says true
          lease_valid: true,
          applied_binding_revision: 0,
          current_binding: null,
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
    });

    render(<CompanionInstallCard />);

    // Both header badge and host row badge must render Enrolled (Offline) because scalar disconnected === false
    expect(screen.getAllByText("Enrolled (Offline)").length).toBe(2);
    expect(screen.queryByText(/Connected \(1\)/)).toBeNull();
    expect(screen.queryByText("Connected (Unbound)")).toBeNull();
  });
});
