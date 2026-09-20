import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRunAdapter } from "./HttpRunAdapter.js";

afterEach(() => vi.unstubAllGlobals());

describe("HttpRunAdapter", () => {
  it("bounds list requests, encodes cursors, and defaults to metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ schema_version: 1, runs: [] }) });
    vi.stubGlobal("fetch", fetch);
    await new HttpRunAdapter("http://daemon").list("opaque + cursor", 999);
    expect(fetch.mock.calls[0][0]).toContain("limit=100");
    expect(fetch.mock.calls[0][0]).toContain("cursor=opaque+%2B+cursor");
    await new HttpRunAdapter("http://daemon").get("run/a");
    expect(fetch.mock.calls[1][0]).not.toContain("include_debug");
  });
  it("requires an injected capability for debug and keeps token in memory", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    await new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:read:debug"]),
      authToken: "secret",
    }).get("run", true);
    expect(fetch.mock.calls[0][0]).toContain("include_debug=true");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer secret");
    await new HttpRunAdapter("http://daemon").get("run", true);
    expect(fetch.mock.calls[1][0]).not.toContain("include_debug");
  });
  it("preserves generic status for UI clearing and denies unavailable mutations", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    await expect(new HttpRunAdapter("http://daemon").get("run")).rejects.toMatchObject({
      status: 403,
    });
    await expect(new HttpRunAdapter("http://daemon").export("run")).rejects.toThrow("unavailable");
    await expect(new HttpRunAdapter("http://daemon").delete("run")).rejects.toThrow("unavailable");
  });

  it("uses authenticated encoded export and DELETE requests, including empty DELETE success", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(["export"]) })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpRunAdapter("http://daemon", {
      capabilities: new Set(["run:export", "run:delete"]),
      authToken: "secret",
    });

    await expect(adapter.export("run/a")).resolves.toBeInstanceOf(Blob);
    await expect(adapter.delete("run/a")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("http://daemon/v1/runs/run%2Fa/export");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer secret");
    expect(fetch.mock.calls[1][0]).toBe("http://daemon/v1/runs/run%2Fa");
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });
});
