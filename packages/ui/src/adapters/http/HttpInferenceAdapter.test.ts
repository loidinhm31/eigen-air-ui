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

  it("cancelOperation() posts to /v1/inference/operations/:id/cancel", async () => {
    const mockSnapshot = {
      operation_id: "op-cancel-1",
      host_id: "host-1",
      artifact_id: "gemma-4",
      kind: "load",
      state: "cancelling",
      stage: "cancelling",
      revision: 3,
      counters: { completed_units: 0, total_units: 1000 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => mockSnapshot,
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HttpInferenceAdapter("http://daemon:18790");
    const result = await adapter.cancelOperation("op-cancel-1");

    expect(result?.operation_id).toBe("op-cancel-1");
    expect(result?.state).toBe("cancelling");
    expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/operations/op-cancel-1/cancel");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
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
    await expect(adapter.cancelOperation("op-err-1")).rejects.toThrow(InferenceHttpError);
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

  describe("Phase 12 Gateway & Host APIs", () => {
    it("downloads prefilled script via existing authenticated adapter with byte bounding", async () => {
      const scriptContent = "#!/bin/bash\necho install";
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(scriptContent));
          controller.close();
        },
      });
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({
          "Content-Type": "text/x-shellscript",
          "Content-Disposition": 'attachment; filename="eigen-air-install.sh"',
        }),
        body: stream,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790", () => ({
        authToken: "secret-token",
        accessRevision: 1,
      }));

      const res = await adapter.downloadInstallationScript("inst-123", 1024 * 1024);
      expect(res.filename).toBe("eigen-air-install.sh");
      expect(res.sizeBytes).toBe(scriptContent.length);
      expect(res.blob.type).toBe("text/x-shellscript");
      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://daemon:18790/v1/inference/installations/inst-123/script"
      );
    });

    it("credential rotation during script body prevents download", async () => {
      let rev = 1;
      let count = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (count === 0) {
            count++;
            controller.enqueue(new TextEncoder().encode("part1"));
          } else if (count === 1) {
            count++;
            rev = 2; // credential rotates mid-stream
            controller.enqueue(new TextEncoder().encode("part2"));
          } else {
            controller.close();
          }
        },
      });
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({
          "Content-Type": "text/plain",
        }),
        body: stream,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790", () => ({
        authToken: "secret-token",
        accessRevision: rev,
      }));

      await expect(adapter.downloadInstallationScript("inst-123")).rejects.toThrow(
        /rotation/i
      );
    });

    it("rejects oversized script download during stream", async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(200));
          controller.close();
        },
      });
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Headers({ "Content-Type": "text/plain" }),
        body: stream,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      await expect(adapter.downloadInstallationScript("inst-1", 100)).rejects.toThrow(
        /limit of 100 bytes/i
      );
    });

    it("listHosts() queries /v1/inference/hosts and decodes host views", async () => {
      const mockHosts = [
        {
          host_id: "host-1",
          installation_id: "inst-1",
          label: "Primary Host",
          platform: "fedora_x86_64",
          agent_version: "0.2.0",
          lifecycle_revision: 3,
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          recovery: {
            desired_revision: 1,
            reconciled_revision: 1,
            auto_load_model: false,
            auto_prepare_kv: false,
            model_ready: false,
            cache_ready: false,
            model_action: "none",
            cache_action: "none",
          },
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockHosts,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const res = await adapter.listHosts();
      expect(res).toHaveLength(1);
      expect(res[0].host_id).toBe("host-1");
      expect(res[0].is_connected).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/hosts");
    });

    it("mutateBinding() sends PUT to /v1/inference/hosts/:id/binding", async () => {
      const mockBinding = {
        host_id: "h1",
        pool_id: "default",
        revision: 4,
        state: "bound",
        changed_at_ms: 1000,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockBinding,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const res = await adapter.mutateBinding("h1", {
        pool_id: "default",
        mutation_id: "mut-1",
        expected_revision: 3,
      });
      expect(res.state).toBe("bound");
      expect(res.revision).toBe(4);
      expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/hosts/h1/binding");
      expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    });

    it("unbindHost() sends DELETE with If-Match header", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ status: "draining", revision: 5 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const res = await adapter.unbindHost("h1", 4);
      expect(res.status).toBe("draining");
      expect(res.revision).toBe(5);
      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      expect(headers.get("If-Match")).toBe('"4"');
      expect(headers.get("x-mutation-id")).toBeDefined();
      expect(fetchMock.mock.calls[0][0]).toContain("mutation_id=");
    });
    it("unbindHost() succeeds when crypto.randomUUID is undefined (Tailscale HTTP context)", async () => {
      vi.stubGlobal("crypto", {
        randomUUID: undefined,
        getRandomValues: (buf: Uint8Array) => buf.fill(0x33),
      });
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ status: "draining", revision: 5 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const res = await adapter.unbindHost("h1", 2);
      expect(res.status).toBe("draining");
      const headers = fetchMock.mock.calls[0][1].headers as Headers;
      const headerMutationId = headers.get("x-mutation-id");
      expect(headerMutationId).toMatch(/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // Must match query parameter exactly
      expect(fetchMock.mock.calls[0][0]).toBe(
        `http://daemon:18790/v1/inference/hosts/h1/binding?mutation_id=${encodeURIComponent(headerMutationId!)}&expected_revision=2`
      );
    });

    it("purgeHostCache() generates fallback mutationId when crypto.randomUUID is undefined", async () => {
      vi.stubGlobal("crypto", {
        randomUUID: undefined,
        getRandomValues: (buf: Uint8Array) => buf.fill(0x44),
      });
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ status: "purged", operation_id: "op-purge-1" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const res = await adapter.purgeHostCache("h1", { session_id: "sess-abc" });
      expect(res.status).toBe("purged");
      expect(res.operation_id).toBe("op-purge-1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://daemon:18790/v1/inference/hosts/h1/cache/purge");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.session_id).toBe("sess-abc");
      expect(body.mutation_id).toMatch(/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("purgeHostCache() preserves explicit caller-provided mutation_id", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ status: "purged" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      await adapter.purgeHostCache("h1", { session_id: "sess-xyz", mutation_id: "explicit-mut-99" });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.mutation_id).toBe("explicit-mut-99");
    });


    it("credential recovery approve and deny endpoints", async () => {
      const mockView = {
        request_id: "r1",
        deployment_id: "dep",
        installation_id: "inst",
        host_id: "h1",
        public_key_fingerprint: "fp",
        requested_credential_generation: 2,
        expiry_ms: 5000,
        status: "approved",
        approval_revision: 1,
        created_at_ms: 1000,
      };
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockView,
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new HttpInferenceAdapter("http://daemon:18790");
      const appRes = await adapter.approveCredentialRecovery("r1", { expected_generation: 2 });
      expect(appRes.status).toBe("approved");
      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://daemon:18790/v1/inference/credential-recoveries/r1/approve"
      );
    });
  });
});
