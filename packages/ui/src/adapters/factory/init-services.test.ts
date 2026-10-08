import { describe, expect, it, vi, beforeEach } from "vitest";
import { HttpArtifactAdapter } from "../http/HttpArtifactAdapter.js";
import { templateList } from "../http/artifact-test-support.js";
import { initServicesForDaemonUrl } from "./init-services.js";
import {
  getArtifactService,
  getConfigService,
  getMemoryService,
  getSkillService,
  getToolApprovalService,
  getToolService,
  getUserQuestionService,
  getVaultKnowledgeService,
  setServiceAccessContext,
} from "./ServiceFactory.js";

describe("init-services", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes services for a daemon URL and attaches access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
      text: async () => JSON.stringify({ status: "ok" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setServiceAccessContext({ authToken: "injected-sentinel-token" });
    initServicesForDaemonUrl("http://localhost:18790");

    expect(getConfigService()).toBeDefined();
    expect(getMemoryService()).toBeDefined();
    expect(getToolService()).toBeDefined();
    expect(getSkillService()).toBeDefined();
    expect(getVaultKnowledgeService()).toBeDefined();
    expect(getUserQuestionService()).toBeDefined();
    expect(getToolApprovalService()).toBeDefined();
    expect(getArtifactService()).toBeDefined();

    await getConfigService().getConfig();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("init-services artifact adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers an HttpArtifactAdapter at the same HTTP root using the live access closure", async () => {
    const fetchMock = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => Response.json(templateList));
    vi.stubGlobal("fetch", fetchMock);

    setServiceAccessContext({ authToken: "first-token" });
    initServicesForDaemonUrl("https://hub.example.test/proxy/");
    const first = getArtifactService();
    expect(first).toBeInstanceOf(HttpArtifactAdapter);

    await first.listTemplates();
    setServiceAccessContext({ authToken: "second-token" });
    await first.listTemplates();
    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      "https://hub.example.test/proxy/v1/image-templates",
      "https://hub.example.test/proxy/v1/image-templates",
    ]);
    expect(calls.map(([, init]) => new Headers(init.headers).get("Authorization"))).toEqual([
      "Bearer first-token",
      "Bearer second-token",
    ]);

    // Re-initialization replaces the service (same parity as the other adapters).
    initServicesForDaemonUrl("http://localhost:18790");
    const second = getArtifactService();
    expect(second).not.toBe(first);
    await second.listTemplates();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("http://localhost:18790/v1/image-templates");
  });
});
