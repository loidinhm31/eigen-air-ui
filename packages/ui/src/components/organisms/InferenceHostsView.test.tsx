// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InferenceHostsView } from "./InferenceHostsView.js";
import { useInferenceStore } from "../../stores/inferenceStore.js";

const initialStoreState = useInferenceStore.getState();

afterEach(() => {
  cleanup();
  useInferenceStore.setState(initialStoreState, true);
});

describe("InferenceHostsView", () => {
  it("renders host cards, recovery toggles, cache readiness, and operator credential recovery", async () => {
    const user = userEvent.setup();

    const fetchHostsMock = vi.fn().mockResolvedValue(undefined);
    const fetchPoolsMock = vi.fn().mockResolvedValue(undefined);
    const fetchCredentialRecoveriesMock = vi.fn().mockResolvedValue(undefined);
    const fetchHostPreferencesMock = vi.fn().mockResolvedValue(undefined);
    const fetchHostCachesMock = vi.fn().mockResolvedValue(undefined);
    const saveRecoveryPreferencesMock = vi.fn().mockResolvedValue({
      host_id: "host-node-1",
      expected_revision: 2,
      reconciled_revision: 2,
      auto_load_model: true,
      auto_prepare_kv: false,
    });
    const purgeHostCacheMock = vi.fn().mockResolvedValue(undefined);
    const approveCredentialRecoveryMock = vi.fn().mockResolvedValue(undefined);
    const denyCredentialRecoveryMock = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      hosts: {
        "host-node-1": {
          host_id: "host-node-1",
          installation_id: "inst-1",
          label: "Primary GPU Worker",
          platform: "fedora_x86_64",
          agent_version: "1.2.4",
          lifecycle_revision: 5,
          last_seen_at_ms: Date.now(),
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 3,
          recovery: {
            desired_revision: 2,
            reconciled_revision: 2,
            auto_load_model: false,
            auto_prepare_kv: false,
            model_ready: true,
            cache_ready: true,
            model_action: "none",
            cache_action: "none",
          },
          current_binding: {
            host_id: "host-node-1",
            pool_id: "default",
            revision: 3,
            state: "bound",
            changed_at_ms: Date.now(),
          },
        },
      },
      pools: {
        default: {
          pool_id: "default",
          ready_hosts: 1,
          busy_hosts: 0,
          offline_hosts: 0,
          qualified_models: ["gemma-2b"],
        },
      },
      hostPreferences: {
        "host-node-1": {
          host_id: "host-node-1",
          expected_revision: 2,
          reconciled_revision: 2,
          auto_load_model: false,
          auto_prepare_kv: false,
        },
      },
      hostCaches: {
        "host-node-1": [
          {
            host_id: "host-node-1",
            scope_key: "scope-1",
            status: "ready",
            committed_tokens: 2048,
            total_tokens: 2048,
            invalidation_revision: 1,
          },
        ],
      },
      credentialRecoveries: {
        "rec-req-1": {
          request_id: "rec-req-1",
          deployment_id: "dep-1",
          installation_id: "inst-1",
          host_id: "host-node-1",
          public_key_fingerprint: "SHA256:abc123def456",
          requested_credential_generation: 4,
          expiry_ms: Date.now() + 60000,
          status: "pending_approval",
          approval_revision: 1,
          created_at_ms: Date.now() - 5000,
          // Intentionally attach secret fields to simulate upstream payload with secret tokens
          ...({
            secret_key_sentinel: "PRIVATE_KEY_SENTINEL_XYZ_987",
            bearer_token_sentinel: "RAW_BEARER_TOKEN_ABC_123",
          } as unknown as Record<string, unknown>),
        },
      },
      loadingHosts: false,
      fetchHosts: fetchHostsMock,
      fetchPools: fetchPoolsMock,
      fetchCredentialRecoveries: fetchCredentialRecoveriesMock,
      fetchHostPreferences: fetchHostPreferencesMock,
      fetchHostCaches: fetchHostCachesMock,
      saveRecoveryPreferences: saveRecoveryPreferencesMock,
      purgeHostCache: purgeHostCacheMock,
      approveCredentialRecovery: approveCredentialRecoveryMock,
      denyCredentialRecovery: denyCredentialRecoveryMock,
    });

    render(<InferenceHostsView />);

    // Verify initial fetches called
    expect(fetchHostsMock).toHaveBeenCalled();
    expect(fetchPoolsMock).toHaveBeenCalled();
    expect(fetchCredentialRecoveriesMock).toHaveBeenCalled();

    // Verify host card details
    expect(screen.getByText("Primary GPU Worker")).toBeTruthy();
    expect(screen.getByText("ID: host-node-1")).toBeTruthy();
    expect(screen.getByText("fedora_x86_64")).toBeTruthy();
    expect(screen.getByText("v1.2.4")).toBeTruthy();
    expect(screen.getByTestId("connection-status-host-node-1").textContent).toContain("Connected");
    expect(screen.getByTestId("lease-status-host-node-1").textContent).toContain("Lease Valid");

    // Verify readiness badges
    expect(screen.getByTestId("model-readiness-badge").textContent).toContain("Model Ready");
    expect(screen.getByTestId("cache-readiness-badge").textContent).toContain("Cache Ready");

    // Verify recovery toggle interaction
    const autoLoadToggle = screen.getByTestId("toggle-auto-load-model") as HTMLInputElement;
    expect(autoLoadToggle.checked).toBe(false);

    await user.click(autoLoadToggle);
    expect(saveRecoveryPreferencesMock).toHaveBeenCalledWith("host-node-1", {
      expected_revision: 2,
      auto_load_model: true,
      auto_prepare_kv: false,
    });

    // Verify cache purge confirmation and action
    const purgeBtn = screen.getByTestId("purge-cache-button");
    await user.click(purgeBtn);
    expect(screen.getByText("Purge all cache?")).toBeTruthy();

    const confirmPurgeBtn = screen.getByTestId("confirm-purge-cache-button");
    await user.click(confirmPurgeBtn);
    expect(purgeHostCacheMock).toHaveBeenCalledWith("host-node-1");

    // Verify Operator Credential Recovery Section
    const recoverySec = screen.getByTestId("operator-credential-recovery-section");
    expect(recoverySec).toBeTruthy();
    expect(screen.getByText(/SHA256:abc123def456/)).toBeTruthy();
    expect(screen.getByText("Gen: 4")).toBeTruthy();

    // Zero secret leakage verification: ensure NO secret sentinel values are rendered
    expect(screen.queryByText(/PRIVATE_KEY_SENTINEL/i)).toBeNull();
    expect(screen.queryByText(/RAW_BEARER_TOKEN/i)).toBeNull();

    // Approve recovery action
    const approveBtn = screen.getByTestId("approve-recovery-rec-req-1");
    await user.click(approveBtn);
    expect(approveCredentialRecoveryMock).toHaveBeenCalledWith("rec-req-1", {
      expected_generation: 4,
      expected_revision: 1,
    });
  });

  it("handles deny recovery action cleanly and prevents action on expired request", async () => {
    const user = userEvent.setup();
    const denyCredentialRecoveryMock = vi.fn().mockResolvedValue(undefined);

    useInferenceStore.setState({
      hosts: {},
      pools: {},
      credentialRecoveries: {
        "rec-req-2": {
          request_id: "rec-req-2",
          deployment_id: "dep-1",
          installation_id: "inst-1",
          host_id: "host-node-2",
          public_key_fingerprint: "SHA256:789xyz",
          requested_credential_generation: 2,
          expiry_ms: Date.now() + 60000,
          status: "pending_approval",
          approval_revision: 3,
          created_at_ms: Date.now(),
        },
        "rec-req-expired": {
          request_id: "rec-req-expired",
          deployment_id: "dep-1",
          installation_id: "inst-1",
          host_id: "host-node-3",
          public_key_fingerprint: "SHA256:expired123",
          requested_credential_generation: 1,
          expiry_ms: Date.now() - 5000, // Expired
          status: "pending_approval",
          approval_revision: 1,
          created_at_ms: Date.now() - 10000,
        },
      },
      denyCredentialRecovery: denyCredentialRecoveryMock,
    });

    render(<InferenceHostsView />);

    // Deny pending active request
    const denyBtn = screen.getByTestId("deny-recovery-rec-req-2");
    await user.click(denyBtn);
    expect(denyCredentialRecoveryMock).toHaveBeenCalledWith("rec-req-2", 3);

    // Verify expired request has disabled approve/deny buttons
    const expiredDenyBtn = screen.getByTestId("deny-recovery-rec-req-expired") as HTMLButtonElement;
    expect(expiredDenyBtn.disabled).toBe(true);
  });

  it("sanitizes secret-bearing backend error messages during recovery action failure", async () => {
    const user = userEvent.setup();
    const approveCredentialRecoveryMock = vi.fn().mockRejectedValue(
      new Error("Internal error: Bearer secret_token_leak_99999 failed gateway authentication")
    );

    useInferenceStore.setState({
      hosts: {},
      pools: {},
      credentialRecoveries: {
        "rec-leak-test": {
          request_id: "rec-leak-test",
          deployment_id: "dep-1",
          installation_id: "inst-1",
          host_id: "host-leak",
          public_key_fingerprint: "SHA256:fingerprint",
          requested_credential_generation: 1,
          expiry_ms: Date.now() + 60000,
          status: "pending_approval",
          approval_revision: 1,
          created_at_ms: Date.now(),
        },
      },
      approveCredentialRecovery: approveCredentialRecoveryMock,
    });

    render(<InferenceHostsView />);

    const approveBtn = screen.getByTestId("approve-recovery-rec-leak-test");
    await user.click(approveBtn);

    // Verify action error alert is rendered, but sanitized without secret leak
    const errorAlert = screen.getByTestId("recovery-action-error");
    expect(errorAlert).toBeTruthy();
    expect(screen.queryByText(/secret_token_leak_99999/)).toBeNull();
    expect(errorAlert.textContent).toContain("Request rejected by gateway security policy");
  });
});
