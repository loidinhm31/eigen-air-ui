// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanionPairingApproval } from "./CompanionPairingApproval.js";

const mockApprovePairing = vi.fn();

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getInferenceService: () => ({
    approvePairing: (...args: unknown[]) => mockApprovePairing(...args),
  }),
}));

beforeEach(() => {
  mockApprovePairing.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CompanionPairingApproval", () => {
  it("displays server host and account labels", () => {
    render(
      <CompanionPairingApproval
        serverHost="edge-server.local:8080"
        accountLabel="operator@eigen-air.dev"
      />
    );

    expect(screen.getByText("edge-server.local:8080")).toBeDefined();
    expect(screen.getByText("operator@eigen-air.dev")).toBeDefined();
    expect(
      screen.getByText(/No companion tokens or secrets are stored or accessible/i)
    ).toBeDefined();
  });

  it("normalizes code, enables submit at 6 chars, and displays local confirmation on success", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockApprovePairing.mockResolvedValueOnce({
      status: "approved",
      pairing_id: "pair_123456",
      expires_at_ms: Date.now() + 600000,
    });

    render(
      <CompanionPairingApproval
        serverHost="127.0.0.1:18790"
        accountLabel="admin"
        initialPairingId="pair_123456"
        onSuccess={onSuccess}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /approve companion pairing/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    const codeInput = screen.getByLabelText(/6-digit verification code/i);
    await user.type(codeInput, "ab-c 123");
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    await user.click(submitBtn);
    expect(mockApprovePairing).toHaveBeenCalledWith("pair_123456", "ABC123");

    await waitFor(() => {
      expect(screen.getByText(/Pairing Approved on Server/i)).toBeDefined();
      expect(screen.getByText(/Physical local confirmation required:/i)).toBeDefined();
    });
    expect(onSuccess).toHaveBeenCalledWith("pair_123456");
  });

  it("displays invalid code error with remaining attempts counter", async () => {
    const user = userEvent.setup();
    mockApprovePairing.mockRejectedValueOnce({
      code: "invalid_code",
      message: "Invalid code (4 attempts remaining)",
      remaining_attempts: 4,
    });

    render(
      <CompanionPairingApproval
        serverHost="127.0.0.1:18790"
        accountLabel="admin"
        initialPairingId="pair_test"
      />
    );

    const codeInput = screen.getByLabelText(/6-digit verification code/i);
    await user.type(codeInput, "123456");

    await user.click(screen.getByRole("button", { name: /approve companion pairing/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/Invalid verification code \(4 attempts remaining\)/i)).toBeDefined();
      expect(screen.getByText(/4 attempts remaining before this flow is locked/i)).toBeDefined();
    });
  });

  it("handles terminal attempt_limit_exceeded error by locking form", async () => {
    const user = userEvent.setup();
    mockApprovePairing.mockRejectedValueOnce({
      code: "attempt_limit_exceeded",
      message: "Maximum verification attempts exceeded; pairing flow denied",
    });

    render(
      <CompanionPairingApproval
        serverHost="127.0.0.1:18790"
        accountLabel="admin"
        initialPairingId="pair_locked"
      />
    );

    const codeInput = screen.getByLabelText(/6-digit verification code/i);
    await user.type(codeInput, "999999");

    const submitBtn = screen.getByRole("button", { name: /approve companion pairing/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Maximum verification attempts exceeded; pairing flow denied/i)).toBeDefined();
    });

    expect((codeInput as HTMLInputElement).disabled).toBe(true);
  });

  it("handles terminal expired error by displaying expiration notice and locking form", async () => {
    const user = userEvent.setup();
    mockApprovePairing.mockRejectedValueOnce({
      code: "expired",
      message: "Pairing session expired",
    });

    render(
      <CompanionPairingApproval
        serverHost="127.0.0.1:18790"
        accountLabel="admin"
        initialPairingId="pair_expired"
      />
    );

    const codeInput = screen.getByLabelText(/6-digit verification code/i);
    await user.type(codeInput, "111222");

    await user.click(screen.getByRole("button", { name: /approve companion pairing/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pairing session expired/i)).toBeDefined();
    });
  });

  it("redacts any accidental filesystem paths in error messages", async () => {
    const user = userEvent.setup();
    mockApprovePairing.mockRejectedValueOnce(
      new Error("Failed writing credentials at /home/secret/user/.eigen-air/creds.json")
    );

    render(
      <CompanionPairingApproval
        serverHost="127.0.0.1:18790"
        accountLabel="admin"
        initialPairingId="pair_path_leak"
      />
    );

    const codeInput = screen.getByLabelText(/6-digit verification code/i);
    await user.type(codeInput, "123456");

    await user.click(screen.getByRole("button", { name: /approve companion pairing/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/\[redacted-path\]/)).toBeDefined();
      expect(screen.queryByText(/\/home\/secret/)).toBeNull();
    });
  });
});
