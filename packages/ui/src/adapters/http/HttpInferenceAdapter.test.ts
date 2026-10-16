import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpInferenceAdapter, InferenceHttpError } from "./HttpInferenceAdapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpInferenceAdapter", () => {
  it("listServerModels() queries /v1/inference/server/models and decodes items", async () => {
    const mockModels = [
      {
        artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        family: "gemma",
        display_name: "Gemma 4 E4B",
        quantization: "UD-Q4_K_XL",
        installed: true,
        installed_bytes: 4215695776,
        is_loaded: false,
        has_kv_cache: true,
        root_id: "root-1",
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockModels,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790", () => ({
      authToken: "secret-token",
      accessRevision: 1,
    }));

    const result = await adapter.listServerModels();
    expect(result).toHaveLength(1);
    expect(result[0].artifact_id).toBe("gemma-4-e4b-it-qat-ud-q4_k_xl");
    expect(result[0].installed).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/server/models");
  });

  it("downloadServerModel() posts artifact_id and returns canonical snapshot", async () => {
    const mockSnapshot = {
      operation_id: "download-1",
      artifact_id: "qwen-3.8-27b",
      execution_target_kind: "server",
      stage: "download",
      status: "active",
      revision: 1,
      started_at_ms: 1000,
      updated_at_ms: 1000,
      counters: { completed_units: 0, total_units: 1000 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      ok: true,
      json: async () => mockSnapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    const result = await adapter.downloadServerModel("qwen-3.8-27b");

    expect(result.operation_id).toBe("download-1");
    expect(result.stage).toBe("download");
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/server/models/download");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ artifact_id: "qwen-3.8-27b" });
  });

  it("throws InferenceHttpError with server error code and message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({
        error: "unauthorized",
        message: "Only authenticated human users can manage server models",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    await expect(adapter.deleteServerModel("gemma-4")).rejects.toThrow(InferenceHttpError);
  });

  it("listDevices() queries /v1/inference/devices", async () => {
    const mockDevices = [
      {
        device_id: "device-1",
        display_label: "M3 Companion",
        status: "active",
        warning_archived: false,
        protocol_min_version: "1.0",
        protocol_max_version: "1.0",
        runtime_metadata: {},
        created_at: 100,
        updated_at: 200,
        revision: 1,
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockDevices,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    const devices = await adapter.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].device_id).toBe("device-1");
    expect(devices[0].status).toBe("active");
  });
  it("revokeDevice() sends DELETE to /v1/inference/devices/:id", async () => {
    const mockRevoked = {
      device_id: "device-1",
      display_label: "M3 Companion",
      status: "revoked",
      warning_archived: false,
      protocol_min_version: "1.0",
      protocol_max_version: "1.0",
      runtime_metadata: {},
      created_at: 100,
      updated_at: 250,
      revision: 2,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockRevoked,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    const res = await adapter.revokeDevice("device-1");
    expect(res.status).toBe("revoked");
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/devices/device-1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });


  it("retireDevice() posts archive_warning option", async () => {
    const mockRetired = {
      device_id: "device-1",
      display_label: "M3 Companion",
      status: "retired",
      warning_archived: true,
      protocol_min_version: "1.0",
      protocol_max_version: "1.0",
      runtime_metadata: {},
      created_at: 100,
      updated_at: 300,
      revision: 2,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockRetired,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    const result = await adapter.retireDevice("device-1", { archive_warning: true });

    expect(result.status).toBe("retired");
    expect(result.warning_archived).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/devices/device-1/retire");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ archive_warning: true });
  });
});
