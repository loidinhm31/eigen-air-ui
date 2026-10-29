// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HostBindingControls } from "./HostBindingControls.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";
const initialStoreState = useInferenceStore.getState();

afterEach(() => {
  cleanup();
  useInferenceStore.setState(initialStoreState, true);
});
describe("HostBindingControls", () => {
  it("renders Bound state and allows changing pool or triggering unbind confirmation", async () => {
    const user = userEvent.setup();
    const mutateBindingMock = vi.fn().mockResolvedValue({
      host_id: "host-1",
      pool_id: "pool-b",
      revision: 4,
      state: "bound",
      changed_at_ms: Date.now(),
    });
    const unbindHostMock = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      pools: {
        "pool-a": {
          pool_id: "pool-a",
          ready_hosts: 2,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: ["gemma-2b"],
        },
        "pool-b": {
          pool_id: "pool-b",
          ready_hosts: 1,
          busy_hosts: 1,
          offline_hosts: 0,
          qualified_models: ["qwen-7b"],
        },
      },
      mutateBinding: mutateBindingMock,
      unbindHost: unbindHostMock,
    });

    render(
      <HostBindingControls
        hostId="host-1"
        currentBinding={{
          host_id: "host-1",
          pool_id: "pool-a",
          revision: 3,
          state: "bound",
          changed_at_ms: Date.now(),
        }}
        appliedRevision={3}
      />
    );

    // Verify Bound badge
    const boundBadge = screen.getByTestId("binding-badge-bound");
    expect(boundBadge.textContent).toContain("Bound: pool-a");

    // Click Unbind to open confirmation
    const unbindBtn = screen.getByTestId("unbind-button");
    await user.click(unbindBtn);

    // Verify 3 confirmation bullet points
    const confirmation = screen.getByTestId("unbind-confirmation");
    expect(confirmation).toBeTruthy();
    expect(confirmation.textContent).toContain("Scheduling fence & cancel");
    expect(confirmation.textContent).toContain("Retained management connection");
    expect(confirmation.textContent).toContain("No implied cache deletion");

    // Click Cancel unbind
    const cancelBtn = screen.getByTestId("cancel-unbind-button");
    await user.click(cancelBtn);
    expect(screen.queryByTestId("unbind-confirmation")).toBeNull();
    expect(unbindHostMock).not.toHaveBeenCalled();

    // Open confirmation again and confirm
    await user.click(screen.getByTestId("unbind-button"));
    const confirmBtn = screen.getByTestId("confirm-unbind-button");
    await user.click(confirmBtn);

    expect(unbindHostMock).toHaveBeenCalledWith("host-1", 3);
  });

  it("renders Draining state with rebind button and unbind button", async () => {
    const user = userEvent.setup();
    const mutateBindingMock = vi.fn().mockResolvedValue({
      host_id: "host-2",
      pool_id: "pool-a",
      revision: 6,
      state: "bound",
      changed_at_ms: Date.now(),
    });

    useInferenceStore.setState({
      pools: {
        "pool-a": {
          pool_id: "pool-a",
          ready_hosts: 1,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: [],
        },
      },
      mutateBinding: mutateBindingMock,
    });

    render(
      <HostBindingControls
        hostId="host-2"
        currentBinding={{
          host_id: "host-2",
          pool_id: "pool-a",
          revision: 5,
          state: "draining",
          changed_at_ms: Date.now(),
        }}
        appliedRevision={5}
      />
    );

    expect(screen.getByTestId("binding-badge-draining").textContent).toContain("Draining: pool-a");
    const rebindBtn = screen.getByTestId("rebind-button");
    expect(rebindBtn).toBeTruthy();

    await user.click(rebindBtn);
    expect(mutateBindingMock).toHaveBeenCalledWith("host-2", "pool-a", 5);
  });

  it("renders Unbound state and allows binding to a pool", async () => {
    const user = userEvent.setup();
    const mutateBindingMock = vi.fn().mockResolvedValue({
      host_id: "host-3",
      pool_id: "pool-b",
      revision: 1,
      state: "bound",
      changed_at_ms: Date.now(),
    });

    useInferenceStore.setState({
      pools: {
        "pool-b": {
          pool_id: "pool-b",
          ready_hosts: 0,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: [],
        },
      },
      mutateBinding: mutateBindingMock,
    });

    render(<HostBindingControls hostId="host-3" currentBinding={null} appliedRevision={0} />);

    expect(screen.getByTestId("binding-badge-unbound")).toBeTruthy();

    const bindBtn = screen.getByTestId("bind-button");
    expect(bindBtn.textContent).toContain("Bind to Pool");

    await user.click(bindBtn);
    expect(mutateBindingMock).toHaveBeenCalledWith("host-3", "pool-b", 0);
  });
});
