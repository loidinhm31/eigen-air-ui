import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpConfigAdapter } from "./HttpConfigAdapter.js";
import { HttpMemoryAdapter } from "./HttpMemoryAdapter.js";
import { HttpSkillAdapter } from "./HttpSkillAdapter.js";
import { HttpToolAdapter } from "./HttpToolAdapter.js";
import { HttpVaultKnowledgeAdapter } from "./HttpVaultKnowledgeAdapter.js";

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
});
