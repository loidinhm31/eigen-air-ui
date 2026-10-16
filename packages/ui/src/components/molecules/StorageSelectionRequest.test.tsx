// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StorageSelectionRequest } from "./StorageSelectionRequest.js";

const mockRequestDeviceStorageSelection = vi.fn();
const mockGetDeviceStorageSelection = vi.fn();

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getInferenceService: () => ({
    requestDeviceStorageSelection: (...args: unknown[]) => mockRequestDeviceStorageSelection(...args),
    getDeviceStorageSelection: (...args: unknown[]) => mockGetDeviceStorageSelection(...args),
  }),
}));

beforeEach(() => {
  mockRequestDeviceStorageSelection.mockReset();
  mockGetDeviceStorageSelection.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe("StorageSelectionRequest", () => {
  it("triggers selection and renders 'Approve on <device>' waiting state", async () => {
    mockRequestDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-1",
      device_id: "dev-macbook",
      kind: "model_root",
      status: "awaiting_local_approval",
      expires_at_ms: Date.now() + 60000,
    });

    render(<StorageSelectionRequest deviceId="dev-macbook" deviceName="MacBook Pro M3" />);
    const button = screen.getByRole("button", { name: /select storage folder on macbook pro m3/i });
    await act(async () => { button.click(); });

    expect(mockRequestDeviceStorageSelection).toHaveBeenCalledWith("dev-macbook", "model_root", undefined);
    expect(screen.getByText("Approve on MacBook Pro M3")).toBeDefined();
  });

  it("polls and renders approved root ID and sanitized label", async () => {
    const onApproved = vi.fn();
    mockRequestDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-poll",
      device_id: "dev-linux",
      kind: "model_root",
      status: "requested",
      expires_at_ms: Date.now() + 60000,
    });
    mockGetDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-poll",
      device_id: "dev-linux",
      kind: "model_root",
      status: "approved",
      approved_root_id: "root-uuid-42",
      approved_label: "NVMe at /mnt/fast-nvme/cache",
      expires_at_ms: Date.now() + 60000,
    });

    render(<StorageSelectionRequest deviceId="dev-linux" pollIntervalMs={500} onApproved={onApproved} />);
    await act(async () => { screen.getByRole("button", { name: /select storage folder/i }).click(); });
    await act(async () => { vi.advanceTimersByTime(500); });

    expect(mockGetDeviceStorageSelection).toHaveBeenCalledWith("dev-linux", "req-poll");
    expect(screen.getByText("Storage Root Approved")).toBeDefined();
    expect(screen.getByText("root-uuid-42")).toBeDefined();
    expect(screen.getByText(/\[redacted-path\]/)).toBeDefined();
    expect(onApproved).toHaveBeenCalledWith("root-uuid-42");
  });

  it("fails closed if approval response contains a filesystem path as root_id", async () => {
    const onApproved = vi.fn();
    mockRequestDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-path-root",
      device_id: "dev-test",
      kind: "model_root",
      status: "approved",
      approved_root_id: "/etc/shadow",
      expires_at_ms: Date.now() + 60000,
    });

    render(<StorageSelectionRequest deviceId="dev-test" onApproved={onApproved} />);
    await act(async () => { screen.getByRole("button", { name: /select storage folder/i }).click(); });

    expect(screen.getByText(/Selection approved without valid storage root ID/i)).toBeDefined();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("redacts UNC paths, drive letters, and paths with spaces", async () => {
    mockRequestDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-unc",
      device_id: "dev-win",
      kind: "model_root",
      status: "failed",
      error_message: "Access denied on \\\\server\\share\\private\\models or C:\\Program Files\\app",
      expires_at_ms: Date.now() + 60000,
    });

    render(<StorageSelectionRequest deviceId="dev-win" />);
    await act(async () => { screen.getByRole("button", { name: /select storage folder/i }).click(); });

    expect(screen.getByText(/Access denied on \[redacted-path\] or \[redacted-path\]/)).toBeDefined();
    expect(screen.queryByText(/\\\\server\\share/)).toBeNull();
  });

  it("transitions to expired when polling failures exceed deadline", async () => {
    mockRequestDeviceStorageSelection.mockResolvedValueOnce({
      request_id: "req-exp",
      device_id: "dev-exp",
      kind: "model_root",
      status: "requested",
      expires_at_ms: Date.now() + 1000,
    });
    mockGetDeviceStorageSelection.mockRejectedValue(new Error("Network drop"));

    render(<StorageSelectionRequest deviceId="dev-exp" pollIntervalMs={500} />);
    await act(async () => { screen.getByRole("button", { name: /select storage folder/i }).click(); });

    // Advance beyond deadline
    await act(async () => { vi.advanceTimersByTime(1500); });

    expect(screen.getByText(/Storage selection request expired/i)).toBeDefined();
    expect(screen.getByText("Storage Selection expired")).toBeDefined();
  });

  it("fences deferred responses when deviceId changes before resolution", async () => {
    const onApproved = vi.fn();
    let resolveDeferred!: (value: unknown) => void;
    const deferredPromise = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    mockRequestDeviceStorageSelection.mockReturnValueOnce(deferredPromise);
    const { rerender } = render(<StorageSelectionRequest deviceId="dev-A" onApproved={onApproved} />);
    await act(async () => { screen.getByRole("button", { name: /select storage folder on dev-A/i }).click(); });

    // Switch to dev-B while request for dev-A is in flight
    rerender(<StorageSelectionRequest deviceId="dev-B" onApproved={onApproved} />);

    // Resolve dev-A late
    await act(async () => {
      resolveDeferred({
        request_id: "req-late",
        device_id: "dev-A",
        kind: "model_root",
        status: "approved",
        approved_root_id: "root-late",
        expires_at_ms: Date.now() + 60000,
      });
    });

    // dev-A result must be discarded: onApproved not called, state is idle for dev-B
    expect(onApproved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /select storage folder on dev-B/i })).toBeDefined();
  });
});
