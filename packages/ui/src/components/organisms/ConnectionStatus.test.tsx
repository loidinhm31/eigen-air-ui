// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import {
  getServiceAccessContext,
  setServiceAccessContext,
  registerReinitFn,
} from "../../adapters/factory/ServiceFactory.js";
import { initServicesForDaemonUrl } from "../../adapters/factory/init-services.js";
import {
  getStoredAuthToken,
  getStoredTokenRetention,
  saveStoredAuthToken,
  clearStoredAuthToken,
} from "../../adapters/factory/tokenStorage.js";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

const mockChatConnect = vi.fn();
const mockChatDisconnect = vi.fn();
const mockConfigHealth = vi.fn();
const mockConfigGetConfig = vi.fn();
const mockConfigGetStatus = vi.fn();

vi.mock("../../adapters/factory/ServiceFactory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/factory/ServiceFactory.js")>();
  return {
    ...actual,
    getChatService: () => ({
      connect: mockChatConnect,
      disconnect: mockChatDisconnect,
      sendMessage: vi.fn(),
      getHistory: vi.fn(),
      abort: vi.fn(),
      subscribeRunCorrelation: () => () => undefined,
      onRunReconnect: () => () => undefined,
      subscribeUserQuestion: () => () => undefined,
      onQuestionProtocolError: () => () => undefined,
    }),
    getConfigService: () => ({
      health: mockConfigHealth,
      getConfig: mockConfigGetConfig,
      getStatus: mockConfigGetStatus,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearStoredAuthToken();
  setServiceAccessContext({});
  registerReinitFn(() => {
    initServicesForDaemonUrl(useConnectionStore.getState().url);
  });
  useConnectionStore.setState({
    url: "http://localhost:18790",
    status: "disconnected",
    version: undefined,
    sessionId: undefined,
  });

  mockConfigHealth.mockResolvedValue({ status: "ok" });
  mockConfigGetConfig.mockResolvedValue({ server_version: "0.2.0" });
  mockConfigGetStatus.mockResolvedValue({
    status: "idle",
    model: "claude-3-7-sonnet",
    uptime_secs: 120,
    memory_count: 5,
  });
  mockChatConnect.mockResolvedValue({
    version: "0.2.0",
    session_id: "test-session-123",
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectionStatus", () => {
  describe("Token retention & refresh preservation", () => {
    it("persists token to storage on connect and restores it on reload/re-render", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<ConnectionStatus />);

      const sentinelToken = "preserved-secret-token-xyz-12345";
      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);

      await user.type(tokenInput, sentinelToken);

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(screen.getByText("connected")).toBeDefined();
      });

      // Verify token in in-memory access context and storage
      expect(getServiceAccessContext().authToken).toBe(sentinelToken);
      expect(getStoredAuthToken()).toBe(sentinelToken);
      expect(getStoredTokenRetention()).toBe("7d");

      // Verify DOM input has type="password" and autoComplete="off"
      expect(tokenInput.getAttribute("type")).toBe("password");
      expect(tokenInput.getAttribute("autoComplete")).toBe("off");

      unmount();

      // Simulate refresh/reopen: new component mount pre-populates draftToken from storage
      render(<ConnectionStatus />);
      const reloadedInput = screen.getByPlaceholderText(/Bearer token/i) as HTMLInputElement;
      expect(reloadedInput.value).toBe(sentinelToken);
    });

    it("supports custom retention duration selection (e.g. 24h, session)", async () => {
      const user = userEvent.setup();
      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);
      await user.type(tokenInput, "session-scoped-token");

      const retentionSelect = screen.getByLabelText(/Token retention duration/i);
      await user.selectOptions(retentionSelect, "session");

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => expect(screen.getByText("connected")).toBeDefined());

      expect(sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeDefined();
      expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
      expect(getStoredAuthToken()).toBe("session-scoped-token");
      expect(getStoredTokenRetention()).toBe("session");
    });
  });

  describe("Standalone authentication and ordered reconnect", () => {
    it("applies entered token to in-memory context before reinit and connects successfully", async () => {
      const user = userEvent.setup();
      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);
      await user.type(tokenInput, "my-auth-token");

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(mockConfigHealth).toHaveBeenCalledTimes(1);
        expect(mockConfigGetConfig).toHaveBeenCalledTimes(1);
        expect(mockConfigGetStatus).toHaveBeenCalledTimes(1);
        expect(mockChatConnect).toHaveBeenCalledTimes(1);
      });

      expect(getServiceAccessContext().authToken).toBe("my-auth-token");
      expect(useConnectionStore.getState().status).toBe("connected");
      expect(useConnectionStore.getState().sessionId).toBe("test-session-123");
    });

    it("connects in unauthenticated mode when token is left empty and clears stored token", async () => {
      saveStoredAuthToken("old-token");
      const user = userEvent.setup();
      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);
      await user.clear(tokenInput);

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(mockConfigHealth).toHaveBeenCalledTimes(1);
        expect(mockChatConnect).toHaveBeenCalledTimes(1);
      });

      expect(getServiceAccessContext().authToken).toBeUndefined();
      expect(getStoredAuthToken()).toBeUndefined();
      expect(useConnectionStore.getState().status).toBe("connected");
    });

    it("supports token rotation from Token A to Token B", async () => {
      const user = userEvent.setup();
      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);
      const connectBtn = screen.getByRole("button", { name: "Connect" });

      // Connect with Token A
      await user.type(tokenInput, "token-alpha");
      await user.click(connectBtn);
      await waitFor(() => expect(screen.getByText("connected")).toBeDefined());
      expect(getServiceAccessContext().authToken).toBe("token-alpha");
      expect(getStoredAuthToken()).toBe("token-alpha");

      // Rotate to Token B
      await user.clear(tokenInput);
      await user.type(tokenInput, "token-beta");
      await user.click(connectBtn);
      await waitFor(() => expect(mockChatConnect).toHaveBeenCalledTimes(2));

      expect(getServiceAccessContext().authToken).toBe("token-beta");
      expect(getStoredAuthToken()).toBe("token-beta");
    });

    it("clears token from input, access context and storage on Clear button click", async () => {
      const user = userEvent.setup();
      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i) as HTMLInputElement;
      const connectBtn = screen.getByRole("button", { name: "Connect" });

      await user.type(tokenInput, "secret-token");
      await user.click(connectBtn);
      await waitFor(() => expect(screen.getByText("connected")).toBeDefined());
      expect(getStoredAuthToken()).toBe("secret-token");

      const clearBtn = screen.getByRole("button", { name: "Clear" });
      await user.click(clearBtn);

      expect(tokenInput.value).toBe("");
      expect(getServiceAccessContext().authToken).toBeUndefined();
      expect(getStoredAuthToken()).toBeUndefined();
      expect(useConnectionStore.getState().status).toBe("disconnected");
      expect(useConnectionStore.getState().sessionId).toBeUndefined();
      expect(useConnectionStore.getState().url).toBe("http://localhost:18790");
    });
  });

  describe("Host-managed access authority", () => {
    it("renders host-managed explanation and hides standalone token inputs when managedAccess is true", () => {
      setServiceAccessContext({
        authToken: "host-provided-token",
        identityKey: "host-identity",
      });

      render(<ConnectionStatus managedAccess={true} />);

      expect(screen.queryByPlaceholderText(/Bearer token/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
      expect(
        screen.getByText("Authentication is managed by the host application.")
      ).toBeDefined();
    });

    it("preserves host access context on Connect when managedAccess is true", async () => {
      const user = userEvent.setup();
      setServiceAccessContext({
        authToken: "host-token-123",
        identityKey: "host-user",
      });

      render(<ConnectionStatus managedAccess={true} />);

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(mockConfigHealth).toHaveBeenCalledTimes(1);
        expect(mockChatConnect).toHaveBeenCalledTimes(1);
      });

      expect(getServiceAccessContext().authToken).toBe("host-token-123");
      expect(getServiceAccessContext().identityKey).toBe("host-user");
    });
  });

  describe("Safe error handling & cleanup", () => {
    it("sanitizes 401 unauthorized errors without leaking token into error UI", async () => {
      const user = userEvent.setup();
      mockConfigGetConfig.mockRejectedValueOnce(
        new Error("Request failed: 401 Unauthorized with token secret-sentinel-token")
      );

      render(<ConnectionStatus />);

      const tokenInput = screen.getByPlaceholderText(/Bearer token/i);
      await user.type(tokenInput, "secret-sentinel-token");

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });

      const alertText = screen.getByRole("alert").textContent;
      expect(alertText).toBe("Authentication failed (401 Unauthorized)");
      expect(alertText).not.toContain("secret-sentinel-token");
      expect(useConnectionStore.getState().status).toBe("disconnected");
      expect(mockChatDisconnect).toHaveBeenCalled();
    });

    it("sanitizes network failures safely", async () => {
      const user = userEvent.setup();
      mockConfigHealth.mockRejectedValueOnce(new Error("Failed to fetch"));

      render(<ConnectionStatus />);

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      await user.click(connectBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });

      expect(screen.getByRole("alert").textContent).toBe(
        "Network error: Unable to connect to daemon"
      );
      expect(useConnectionStore.getState().status).toBe("disconnected");
    });
  });
});
