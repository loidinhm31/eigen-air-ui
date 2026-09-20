import { describe, expect, it, vi, beforeEach } from "vitest";

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

    const { initServicesForDaemonUrl } = await import("./init-services.js");
    const {
      getConfigService,
      getMemoryService,
      getToolService,
      getSkillService,
      getVaultKnowledgeService,
      getUserQuestionService,
      getToolApprovalService,
      setServiceAccessContext,
    } = await import("./ServiceFactory.js");

    setServiceAccessContext({ authToken: "injected-sentinel-token" });
    initServicesForDaemonUrl("http://localhost:18790");

    expect(getConfigService()).toBeDefined();
    expect(getMemoryService()).toBeDefined();
    expect(getToolService()).toBeDefined();
    expect(getSkillService()).toBeDefined();
    expect(getVaultKnowledgeService()).toBeDefined();
    expect(getUserQuestionService()).toBeDefined();
    expect(getToolApprovalService()).toBeDefined();

    await getConfigService().getConfig();
    expect(fetchMock).toHaveBeenCalled();
  });
});
