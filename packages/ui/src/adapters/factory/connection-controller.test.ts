import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  connectChat,
  startAutoConnect,
  disconnectChat,
  classifyConnectError,
  resetConnectionControllerForTests,
  ConnectSupersededError,
  CONNECT_HEALTH_TIMEOUT_MS,
  AUTO_RETRY_DELAYS_MS,
} from "./connection-controller.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { WsRequestError } from "../ws/ws-request-error.js";
import type { IChatService } from "./interfaces/IChatService.js";
import type { IConfigService } from "./interfaces/IConfigService.js";

const mockChatConnect = vi.fn();
const mockChatDisconnect = vi.fn();
const mockConfigHealth = vi.fn();

let currentChatService: IChatService;
let currentConfigService: IConfigService;
let currentAccessRevision = 0;

vi.mock("./ServiceFactory.js", () => ({
  getChatService: () => currentChatService,
  getConfigService: () => currentConfigService,
  getServiceAccessContext: () => ({ accessRevision: currentAccessRevision }),
}));

function createMockChatService(): IChatService {
  return {
    connect: mockChatConnect,
    disconnect: mockChatDisconnect,
    sendMessage: vi.fn(),
    getHistory: vi.fn(),
    abort: vi.fn(),
  };
}

function createMockConfigService(): IConfigService {
  return {
    health: mockConfigHealth,
    getConfig: vi.fn(),
    getStatus: vi.fn(),
    getReadiness: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  resetConnectionControllerForTests();
  currentChatService = createMockChatService();
  currentConfigService = createMockConfigService();
  currentAccessRevision = 0;
  useConnectionStore.setState({
    url: "http://localhost:18790",
    status: "disconnected",
    version: undefined,
    sessionId: undefined,
    error: undefined,
  });

  mockConfigHealth.mockResolvedValue({ status: "ok" });
  mockChatConnect.mockResolvedValue({ version: "0.2.0", session_id: "s-123" });
});

afterEach(() => {
  resetConnectionControllerForTests();
  vi.useRealTimers();
});

describe("connection-controller", () => {
  describe("error classification", () => {
    it("classifies unauthorized error as unauthenticated", () => {
      const err = new WsRequestError("unauthorized", "invalid token", "connect");
      expect(classifyConnectError(err)).toBe("unauthenticated");
    });

    it("classifies unsupported_daemon error as unsupported_daemon", () => {
      const err = new WsRequestError("unsupported_daemon", "upgrade daemon", "sessions.get");
      expect(classifyConnectError(err)).toBe("unsupported_daemon");
    });

    it("classifies timeout errors as timeout", () => {
      const timeoutErr = new Error("Health check timed out");
      timeoutErr.name = "TimeoutError";
      expect(classifyConnectError(timeoutErr)).toBe("timeout");

      const wsTimeout = new WsRequestError("timeout", "request timed out", "connect");
      expect(classifyConnectError(wsTimeout)).toBe("timeout");
    });

    it("classifies unknown errors as unreachable", () => {
      expect(classifyConnectError(new Error("Network failed"))).toBe("unreachable");
    });
  });

  describe("intent handling & deduplication", () => {
    it("concurrent auto + auto requests share one connect call", async () => {
      const p1 = connectChat({ intent: "auto" });
      const p2 = connectChat({ intent: "auto" });

      expect(p1).toBe(p2);
      const res = await p1;

      expect(res.session_id).toBe("s-123");
      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().status).toBe("connected");
      expect(useConnectionStore.getState().sessionId).toBe("s-123");
    });

    it("manual supersedes in-flight auto, and auto result writes nothing", async () => {
      let resolveAuto!: (val: unknown) => void;
      const autoPromise = new Promise((resolve) => {
        resolveAuto = resolve;
      });
      mockChatConnect
        .mockImplementationOnce(() => autoPromise)
        .mockResolvedValueOnce({ version: "0.2.0", session_id: "s-manual" });

      const autoP = connectChat({ intent: "auto" });
      // Allow config.health to resolve so auto enters service.connect
      await Promise.resolve();
      await Promise.resolve();

      const beforeConnectOrder: string[] = [];

      const manualP = connectChat({
        intent: "manual",
        beforeConnect: () => {
          beforeConnectOrder.push("beforeConnect");
        },
      });

      expect(beforeConnectOrder).toEqual(["beforeConnect"]);
      resolveAuto({ version: "0.1.0", session_id: "s-auto" });
      await expect(autoP).rejects.toThrow(ConnectSupersededError);
      const manualRes = await manualP;

      expect(manualRes.session_id).toBe("s-manual");
      expect(useConnectionStore.getState().sessionId).toBe("s-manual");
      expect(useConnectionStore.getState().status).toBe("connected");
    });

    it("reentrant access-change fired synchronously inside beforeConnect joins the attempt", async () => {
      let joinedPromise: Promise<unknown> | null = null;
      let resolveConnect!: (val: unknown) => void;
      mockChatConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );

      const manualP = connectChat({
        intent: "manual",
        beforeConnect: () => {
          joinedPromise = connectChat({ intent: "access-change" });
        },
      });

      expect(joinedPromise).toBe(manualP);
      await Promise.resolve();
      await Promise.resolve();
      resolveConnect({ version: "0.2.0", session_id: "s-joined" });
      const res = await manualP;
      expect(res.session_id).toBe("s-joined");
      expect(mockChatConnect).toHaveBeenCalledTimes(1);
    });

    it("handles synchronous beforeConnect exception without leaving active attempt", async () => {
      const err = new Error("beforeConnect failed");
      await expect(
        connectChat({
          intent: "manual",
          beforeConnect: () => {
            throw err;
          },
        })
      ).rejects.toThrow(err);

      // Subsequent connect should start cleanly without being blocked
      const nextP = connectChat({ intent: "auto" });
      const res = await nextP;
      expect(res.session_id).toBe("s-123");
    });

    it("stale failure never disconnects replacement service", async () => {
      const oldService = currentChatService;
      let rejectOldConnect!: (err: unknown) => void;
      mockChatConnect.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOldConnect = reject;
          })
      );

      const oldAttempt = connectChat({ intent: "manual" });
      await Promise.resolve();
      await Promise.resolve();

      // Swap to replacement service
      const newService = createMockChatService();
      currentChatService = newService;

      const newAttempt = connectChat({ intent: "manual" });

      // Reject old attempt after new attempt has started
      rejectOldConnect(new Error("Old connect network failure"));
      await expect(oldAttempt).rejects.toThrow(ConnectSupersededError);
      await newAttempt;

      expect(oldService.disconnect).not.toHaveBeenCalled();
      expect(newService.disconnect).not.toHaveBeenCalled();
      expect(useConnectionStore.getState().status).toBe("connected");
    });

    it("access-change joins same-revision attempt and supersedes older revision", async () => {
      currentAccessRevision = 2;
      let resolveFirst!: (val: unknown) => void;
      mockChatConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      );

      const first = connectChat({ intent: "auto" });
      await Promise.resolve();
      await Promise.resolve();

      // access-change with same revision joins
      const joined = connectChat({ intent: "access-change" });
      expect(joined).toBe(first);

      // Bump revision: access-change should now supersede
      currentAccessRevision = 3;
      const superseding = connectChat({ intent: "access-change" });
      expect(superseding).not.toBe(first);

      resolveFirst({ version: "0.2.0", session_id: "s-123" });
      await expect(first).rejects.toThrow(ConnectSupersededError);
    });

    it("auto request does not join attempt of a replaced service, it supersedes it", async () => {
      let resolveFirst!: (val: unknown) => void;
      mockChatConnect.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      );

      const firstAuto = connectChat({ intent: "auto" });
      await Promise.resolve();
      await Promise.resolve();

      // Swap to replacement service
      const newService = createMockChatService();
      currentChatService = newService;

      // Second auto connect must NOT join the old attempt; it supersedes it
      const secondAuto = connectChat({ intent: "auto" });
      expect(secondAuto).not.toBe(firstAuto);

      resolveFirst({ version: "0.1.0", session_id: "s-old" });

      await expect(firstAuto).rejects.toThrow(ConnectSupersededError);
      const res = await secondAuto;
      expect(res.session_id).toBe("s-123");
    });
  });

  describe("timeouts & disconnection", () => {
    it("health check timeout rejects with timeout error kind", async () => {
      vi.useFakeTimers();
      mockConfigHealth.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const p = connectChat({ intent: "manual" });
      // Attach handler to avoid unhandled rejection in promise runner
      p.catch(() => {});

      await vi.advanceTimersByTimeAsync(CONNECT_HEALTH_TIMEOUT_MS + 100);

      await expect(p).rejects.toThrow(/timed out/i);
      expect(useConnectionStore.getState().status).toBe("disconnected");
      expect(useConnectionStore.getState().error).toBe("timeout");
    });

    it("disconnectChat aborts in-flight attempt and prevents later writes", async () => {
      let resolveConnect!: (val: unknown) => void;
      mockChatConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );

      const p = connectChat({ intent: "manual" });
      await Promise.resolve();
      await Promise.resolve();
      disconnectChat();

      expect(useConnectionStore.getState().status).toBe("disconnected");
      expect(useConnectionStore.getState().error).toBeUndefined();

      resolveConnect({ version: "0.2.0", session_id: "late-id" });
      await expect(p).rejects.toThrow(ConnectSupersededError);

      expect(useConnectionStore.getState().status).toBe("disconnected");
      expect(useConnectionStore.getState().sessionId).toBeUndefined();
    });
  });

  describe("auto-connect loop", () => {
    it("stops auto loop after unauthenticated error without further retries", async () => {
      vi.useFakeTimers();
      mockChatConnect.mockRejectedValue(
        new WsRequestError("unauthorized", "bad token", "connect")
      );

      startAutoConnect();

      // Flush microtasks
      await vi.advanceTimersByTimeAsync(0);

      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().error).toBe("unauthenticated");

      // Advance through all retry timers
      for (const delay of AUTO_RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay + 100);
      }

      // No additional connect calls should have occurred
      expect(mockChatConnect).toHaveBeenCalledTimes(1);
    });

    it("stops auto loop after unsupported_daemon error without further retries", async () => {
      vi.useFakeTimers();
      mockChatConnect.mockRejectedValue(
        new WsRequestError("unsupported_daemon", "daemon outdated", "sessions.get")
      );

      startAutoConnect();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().error).toBe("unsupported_daemon");

      for (const delay of AUTO_RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay + 100);
      }

      expect(mockChatConnect).toHaveBeenCalledTimes(1);
    });

    it("manual success during auto sleep stops auto loop", async () => {
      vi.useFakeTimers();
      // First auto attempt fails with reachable network error
      mockChatConnect.mockRejectedValueOnce(new Error("Temporary network glitch"));

      startAutoConnect();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().status).toBe("disconnected");

      // During sleep before retry 1, manual connect succeeds
      mockChatConnect.mockResolvedValueOnce({ version: "0.2.0", session_id: "s-manual" });
      await connectChat({ intent: "manual" });

      expect(useConnectionStore.getState().status).toBe("connected");

      // Advance past sleep delay
      await vi.advanceTimersByTimeAsync(AUTO_RETRY_DELAYS_MS[0] + 100);

      // Loop should see status === "connected" after sleep and stop
      expect(mockChatConnect).toHaveBeenCalledTimes(2); // 1 auto fail + 1 manual success
    });

    it("disconnectChat during auto retry sleep stops auto loop completely", async () => {
      vi.useFakeTimers();
      // First auto attempt fails with transient network glitch
      mockChatConnect.mockRejectedValueOnce(new Error("Transient glitch"));

      startAutoConnect();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().status).toBe("disconnected");

      // User triggers Clear / disconnectChat during retry backoff sleep
      disconnectChat();

      // Advance through all retry delays
      for (const delay of AUTO_RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay + 100);
      }

      // No new connect call should have been started
      expect(mockChatConnect).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().status).toBe("disconnected");
    });

    it("StrictMode start -> cancel -> start results in one connect call", async () => {
      let resolveConnect!: (val: unknown) => void;
      mockChatConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      );

      // Mount 1
      const cancel1 = startAutoConnect();
      // Unmount 1 (cancels loop retries, does not abort active attempt)
      cancel1();

      // Mount 2 (joins existing in-flight attempt)
      const cancel2 = startAutoConnect();

      await Promise.resolve();
      await Promise.resolve();
      expect(mockChatConnect).toHaveBeenCalledTimes(1);

      resolveConnect({ version: "0.2.0", session_id: "s-strict" });

      // Flush microtasks
      await Promise.resolve();
      await Promise.resolve();

      expect(useConnectionStore.getState().status).toBe("connected");
      expect(useConnectionStore.getState().sessionId).toBe("s-strict");

      cancel2();
    });
  });
});
