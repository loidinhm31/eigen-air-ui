import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpConfigAdapter } from "./HttpConfigAdapter.js";

afterEach(() => vi.unstubAllGlobals());

describe("HttpConfigAdapter endpoints contract", () => {
  it("hits /health for health check without Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", version: "0.1.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon");
    const result = await adapter.health();
    expect(result).toEqual({ status: "ok", version: "0.1.0" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/health");
  });

  it("hits /config with Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.1.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon");
    await adapter.getConfig();
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/config");
  });

  it("hits /v1/status with Authorization header and returns gateway status", async () => {
    const statusPayload = {
      status: "idle",
      model: "local-llama",
      uptime_secs: 42,
      memory_count: 3,
      readiness: {
        status: "ready",
        retryable: false,
        details: { stages: [] },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => statusPayload,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon", { authToken: "mock-auth-token" });
    const result = await adapter.getStatus();
    expect(result).toEqual(statusPayload);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/status");
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer mock-auth-token");
  });

  it("hits /readyz in public mode without Authorization header", async () => {
    const readySnapshot = {
      status: "ready",
      retryable: false,
      details: { stages: [] },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => readySnapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon", { authToken: "mock-auth-token" });
    const result = await adapter.getReadiness();
    expect(result).toEqual(readySnapshot);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/readyz");
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("parses 503 snapshot from /readyz during model startup as valid data", async () => {
    const startingSnapshot = {
      status: "starting",
      retryable: true,
      details: {
        stages: [{ name: "model_load", status: "running" }],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      json: async () => startingSnapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon");
    const result = await adapter.getReadiness();
    expect(result).toEqual(startingSnapshot);
    expect(result.status).toBe("starting");
  });

  it("rejects /readyz with error when HTTP status is not 200 or 503", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ message: "Internal server error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon");
    await expect(adapter.getReadiness()).rejects.toThrow("Internal server error");
  });

  it("forwards AbortSignal to /readyz fetch call", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: "ready", retryable: false, details: { stages: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpConfigAdapter("http://daemon");
    await adapter.getReadiness(controller.signal);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
