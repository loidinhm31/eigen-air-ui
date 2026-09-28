import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpMemoryAdapter,
  MemoryHttpError,
  errorKindForMemoryStatus,
} from "./HttpMemoryAdapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpMemoryAdapter error discrimination and contracts", () => {
  it("maps status codes and error codes to correct MemoryHttpErrorKind", () => {
    expect(errorKindForMemoryStatus(401)).toBe("unauthorized");
    expect(errorKindForMemoryStatus(403)).toBe("forbidden");
    expect(errorKindForMemoryStatus(404)).toBe("not_found");
    expect(errorKindForMemoryStatus(409)).toBe("conflict");
    expect(errorKindForMemoryStatus(400)).toBe("invalid");
    expect(errorKindForMemoryStatus(400, "sensitive_content")).toBe("sensitive_content");
    expect(errorKindForMemoryStatus(500)).toBe("server_error");
    expect(errorKindForMemoryStatus(503)).toBe("server_error");
  });

  it("getEpisode returns EpisodicMemory on 200 OK", async () => {
    const mockEpisode = {
      id: "ep-1",
      input: "user text",
      output: "assistant text",
      summary: "summary text",
      created_at_ms: 1000,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockEpisode,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon", { authToken: "token-123" });
    const result = await adapter.getEpisode("ep-1");
    expect(result).toEqual(mockEpisode);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/memory/episodes/ep-1");
  });

  it("getEpisode maps 404 to null (source unavailable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({ error: "not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon", { authToken: "token-123" });
    const result = await adapter.getEpisode("ep-missing");
    expect(result).toBeNull();
  });

  it("getEpisode throws MemoryHttpError on 401 unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ message: "Unauthorized token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon", { authToken: "bad-token" });
    await expect(adapter.getEpisode("ep-1")).rejects.toThrow(MemoryHttpError);
    await expect(adapter.getEpisode("ep-1")).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      message: "Unauthorized token",
    });
  });

  it("getEpisode throws MemoryHttpError on 403 forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({ message: "Scope denied" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon", { authToken: "token-123" });
    await expect(adapter.getEpisode("ep-foreign")).rejects.toThrow(MemoryHttpError);
    await expect(adapter.getEpisode("ep-foreign")).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
  });

  it("getEpisode throws MemoryHttpError on 500 server error (retryable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({ message: "Database down" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon");
    await expect(adapter.getEpisode("ep-1")).rejects.toMatchObject({
      kind: "server_error",
      status: 500,
      message: "Database down",
    });
  });

  it("getEpisode throws MemoryHttpError on network communication failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon");
    await expect(adapter.getEpisode("ep-1")).rejects.toMatchObject({
      kind: "network_error",
      status: 0,
      message: "Failed to fetch",
    });
  });

  it("forwards AbortSignal and maps cancellation to aborted error kind", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon");
    await expect(adapter.getEpisode("ep-1", { signal: controller.signal })).rejects.toMatchObject({
      kind: "aborted",
      status: 0,
    });
  });

  it("updateEpisode rejects sensitive transcript edits with sensitive_content kind", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({
        error: "sensitive_content",
        message: "Sensitive transcript edits are rejected",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpMemoryAdapter("http://daemon");
    await expect(
      adapter.updateEpisode("ep-1", { input: "password is 123" })
    ).rejects.toMatchObject({
      kind: "sensitive_content",
      status: 400,
      code: "sensitive_content",
      message: "Sensitive transcript edits are rejected",
    });
  });

  it("recall maps 404 to null and throws on auth denial", async () => {
    const fetchMock404 = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock404);
    const adapter = new HttpMemoryAdapter("http://daemon");
    expect(await adapter.recall("missing-key")).toBeNull();

    const fetchMock403 = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({ message: "Denied" }),
    });
    vi.stubGlobal("fetch", fetchMock403);
    await expect(adapter.recall("secret-key")).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
  });

  it("deleteEpisode sends DELETE request and passes signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ id: "ep-1", deleted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const adapter = new HttpMemoryAdapter("http://daemon");
    await adapter.deleteEpisode("ep-1", { signal: controller.signal });

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/memory/episodes/ep-1");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
