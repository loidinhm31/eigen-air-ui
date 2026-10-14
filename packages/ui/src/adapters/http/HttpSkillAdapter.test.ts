import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpSkillAdapter,
  SkillHttpError,
} from "./HttpSkillAdapter.js";
import { errorKindForSkillStatus } from "./skill-error-helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpSkillAdapter error discrimination and status mapping", () => {
  it("maps status codes and specialized error codes to correct SkillHttpErrorKind", () => {
    expect(errorKindForSkillStatus(401)).toBe("unauthorized");
    expect(errorKindForSkillStatus(403)).toBe("forbidden");
    expect(errorKindForSkillStatus(404)).toBe("not_found");
    expect(errorKindForSkillStatus(409)).toBe("conflict");
    expect(errorKindForSkillStatus(409, "skill_id_collision")).toBe("conflict");
    expect(errorKindForSkillStatus(409, "skill_import_busy")).toBe("conflict");
    expect(errorKindForSkillStatus(412)).toBe("precondition_failed");
    expect(errorKindForSkillStatus(412, "stale_revision")).toBe("precondition_failed");
    expect(errorKindForSkillStatus(413)).toBe("payload_too_large");
    expect(errorKindForSkillStatus(413, "quota_exceeded")).toBe("payload_too_large");
    expect(errorKindForSkillStatus(415)).toBe("unsupported_media_type");
    expect(errorKindForSkillStatus(428)).toBe("precondition_required");
    expect(errorKindForSkillStatus(400)).toBe("invalid");
    expect(errorKindForSkillStatus(500)).toBe("server_error");
    expect(errorKindForSkillStatus(503)).toBe("server_error");
  });
});

describe("HttpSkillAdapter management API endpoints", () => {
  it("list() calls /v1/skills in public mode by default", async () => {
    const mockSkills = [
      {
        id: "local_image",
        name: "local_image",
        description: "Generate images",
        source: "bundled",
        format: "toml",
        enabled: true,
        compatibility: "native",
        eligibility: "selectable",
        required_tools: ["local_image"],
        optional_tools: [],
        diagnostics: [],
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockSkills,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon");
    const result = await adapter.list();

    expect(result).toEqual(mockSkills);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBeNull();
  });

  it("list({ includeDisabled: true }) calls /v1/skills?include_disabled=true with owner token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    await adapter.list({ includeDisabled: true });

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills?include_disabled=true");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer owner-token");
  });

  it("search() calls /v1/skills/search?q=...", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon");
    await adapter.search("image gen");

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/search?q=image%20gen");
  });

  it("get() calls /v1/skills/:id and returns detail", async () => {
    const mockDetail = {
      id: "qwen-image-local",
      name: "qwen-image-local",
      description: "Qwen local image",
      source: "imported",
      format: "markdown",
      enabled: false,
      compatibility: "native",
      eligibility: "disabled",
      system_prompt: "# Prompt",
      resources: [{ path: "REFERENCE.md", size: 120, sha256: "hash123" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockDetail,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    const res = await adapter.get("qwen-image-local");

    expect(res).toEqual(mockDetail);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/qwen-image-local");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer owner-token");
  });

  it("importPackage() sends multipart FormData to /v1/skills/import", async () => {
    const mockCreated = {
      id: "imported-pkg",
      name: "imported-pkg",
      description: "Desc",
      source: "imported",
      format: "markdown",
      enabled: false,
      compatibility: "native",
      eligibility: "disabled",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => mockCreated,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    const dummyBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" });
    const res = await adapter.importPackage(dummyBlob, "my-skill.zip");

    expect(res).toEqual(mockCreated);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/import");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body instanceof FormData).toBe(true);
    // Boundary must be set by fetch, not manual Content-Type header
    expect(fetchMock.mock.calls[0][1].headers.get("Content-Type")).toBeNull();
  });

  it("replacePackage() sends PUT to /v1/skills/:id/package with If-Match and x-skill-install-id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ id: "pkg-1", enabled: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    const dummyBlob = new Blob([new Uint8Array([4, 5, 6])], { type: "application/zip" });
    await adapter.replacePackage("pkg-1", dummyBlob, {
      contentRevision: "rev-abc",
      installId: "install-uuid-1",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/pkg-1/package");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(fetchMock.mock.calls[0][1].headers.get("If-Match")).toBe('"rev-abc"');
    expect(fetchMock.mock.calls[0][1].headers.get("x-skill-install-id")).toBe("install-uuid-1");
  });

  it("setEnabled() sends PATCH to /v1/skills/:id with If-Match local_state_revision and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ id: "pkg-1", enabled: true, local_state_revision: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    await adapter.setEnabled("pkg-1", true, {
      localRevision: 1,
      installId: "install-uuid-1",
      inspectedRevision: "rev-abc",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/pkg-1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[0][1].headers.get("If-Match")).toBe('"1"');
    expect(fetchMock.mock.calls[0][1].headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      enabled: true,
      install_id: "install-uuid-1",
      inspected_content_revision: "rev-abc",
    });
  });

  it("uninstall() sends DELETE to /v1/skills/:id with If-Match content_revision and x-skill-install-id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    await adapter.uninstall("pkg-1", {
      contentRevision: "rev-abc",
      installId: "install-uuid-1",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/pkg-1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[0][1].headers.get("If-Match")).toBe('"rev-abc"');
    expect(fetchMock.mock.calls[0][1].headers.get("x-skill-install-id")).toBe("install-uuid-1");
  });

  it("getResource() sends GET to /v1/skills/:id/resources?path=... with optional version headers", async () => {
    const mockResource = {
      path: "REFERENCE.md",
      content: "# Reference info",
      size: 16,
      truncated: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockResource,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    const res = await adapter.getResource("pkg-1", "docs/guide.md", {
      contentRevision: "rev-abc",
      installId: "install-uuid-1",
    });

    expect(res).toEqual(mockResource);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon/v1/skills/pkg-1/resources?path=docs%2Fguide.md");
    expect(fetchMock.mock.calls[0][1].headers.get("If-Match")).toBe('"rev-abc"');
    expect(fetchMock.mock.calls[0][1].headers.get("x-skill-install-id")).toBe("install-uuid-1");
  });

  it("fences requests when accessRevision rotates during in-flight call", async () => {
    let revision = 1;
    const fetchMock = vi.fn().mockImplementation(async () => {
      revision = 2; // Simulate principal or token rotation while fetch is waiting
      return {
        status: 200,
        ok: true,
        json: async () => [],
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", () => ({
      authToken: "token",
      accessRevision: revision,
    }));

    await expect(adapter.list()).rejects.toMatchObject({
      name: "SkillHttpError",
      kind: "aborted",
    });
  });

  it("handles 412 stale_revision error and exposes status and error code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 412,
      ok: false,
      json: async () => ({ error: "stale_revision", message: "Revision mismatch" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpSkillAdapter("http://daemon", { authToken: "owner-token" });
    await expect(
      adapter.setEnabled("pkg-1", true, { localRevision: 1 })
    ).rejects.toMatchObject({
      status: 412,
      kind: "precondition_failed",
      code: "stale_revision",
    });
  });
});
