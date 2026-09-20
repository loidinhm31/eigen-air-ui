import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithAccess } from "./AuthenticatedHttpRequest.js";

afterEach(() => vi.unstubAllGlobals());

describe("AuthenticatedHttpRequest", () => {
  it("attaches Authorization header with exact token and credentials: omit in protected mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const token = "test-token-sentinel-xyz";
    await fetchWithAccess("http://daemon", "/v1/test", { authToken: token });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://daemon/v1/test");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("omits Authorization header when token is empty or undefined in protected mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAccess("http://daemon", "/v1/test", {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init1] = fetchMock.mock.calls[0];
    expect(new Headers(init1.headers).get("Authorization")).toBeNull();
    expect(init1.credentials).toBe("omit");

    await fetchWithAccess("http://daemon", "/v1/test", undefined);
    const [, init2] = fetchMock.mock.calls[1];
    expect(new Headers(init2.headers).get("Authorization")).toBeNull();
  });

  it("omits Authorization header in public mode even if token is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAccess(
      "http://daemon",
      "/health",
      { authToken: "secret-token" },
      undefined,
      "public"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://daemon/health");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(init.credentials).toBe("omit");
  });

  it("rotates token at request time using a getter function", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    let currentToken = "token-alpha";
    const accessProvider = () => ({ authToken: currentToken });

    await fetchWithAccess("http://daemon", "/v1/resource", accessProvider);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe(
      "Bearer token-alpha"
    );

    currentToken = "token-beta";
    await fetchWithAccess("http://daemon", "/v1/resource", accessProvider);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Authorization")).toBe(
      "Bearer token-beta"
    );
  });

  it("overrides caller-supplied Authorization header with access authority", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAccess(
      "http://daemon",
      "/v1/resource",
      { authToken: "valid-token" },
      {
        headers: {
          Authorization: "Bearer forged-token",
          Accept: "application/json",
          "X-Custom": "custom-value",
        },
      }
    );

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer valid-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Custom")).toBe("custom-value");
  });

  it("preserves method, body, cache, and signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const body = JSON.stringify({ key: "val" });

    await fetchWithAccess(
      "http://daemon",
      "/v1/resource",
      { authToken: "my-token" },
      {
        method: "POST",
        body,
        cache: "no-store",
        signal: controller.signal,
      }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(body);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBe(controller.signal);
    expect(init.credentials).toBe("omit");
  });

  it("does not mutate or alter token bytes in the Authorization header construction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const complexToken = "exact-token_123.abc!def";
    await fetchWithAccess("http://daemon", "/v1/test", { authToken: complexToken });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${complexToken}`);
  });
});
