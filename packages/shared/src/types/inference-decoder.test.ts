import { describe, expect, it } from "vitest";
import {
  decodeApprovePairingResponse,
  decodeCanonicalOperationSnapshot,
  decodeCatalogArtifact,
  decodeExecutionTarget,
  decodeExecutionTargetInput,
  decodeHostCacheStatus,
  decodeHostModelRecommendation,
  decodeHostRecord,
  decodeHostRecoveryPreferences,
  decodeHostView,
  decodeInferenceOperationProgressEvent,
  decodeInstallationDescriptor,
  decodeInstallationStatus,
  decodeModelInventoryItem,
  decodeOperatorRecoveryView,
  decodePoolBinding,
  decodePoolSummary,
  decodePublicDeviceSummary,
  decodeRunInferenceProgressEvent,
  decodeStageCounters,
  decodeStorageRootDescriptor,
  decodeStorageSelectionResponse,
} from "./inference-decoder.js";
describe("inference-decoder", () => {
  describe("decodeStageCounters", () => {
    it("decodes valid stage counters and sanitizes negative/infinite values", () => {
      const counters = decodeStageCounters({
        unit: "bytes",
        completed_units: 1024,
        total_units: 2048,
        bytes_per_second: 512.5,
        estimated_remaining_seconds: 2.0,
        reused_prompt_tokens: 10,
        evaluated_prompt_tokens: 50,
        generated_tokens: 120,
        tokens_per_second: 24.5,
      });

      expect(counters.unit).toBe("bytes");
      expect(counters.completed_units).toBe(1024);
      expect(counters.total_units).toBe(2048);
      expect(counters.bytes_per_second).toBe(512.5);
      expect(counters.estimated_remaining_seconds).toBe(2.0);
      expect(counters.reused_prompt_tokens).toBe(10);
      expect(counters.evaluated_prompt_tokens).toBe(50);
      expect(counters.generated_tokens).toBe(120);
      expect(counters.tokens_per_second).toBe(24.5);
    });

    it("returns empty object for non-object inputs", () => {
      expect(decodeStageCounters(null)).toEqual({});
      expect(decodeStageCounters(undefined)).toEqual({});
      expect(decodeStageCounters("string")).toEqual({});
      expect(decodeStageCounters([1, 2, 3])).toEqual({});
    });
  });

  describe("decodeCanonicalOperationSnapshot", () => {
    it("decodes valid operation snapshot", () => {
      const raw = {
        operation_id: "op-123",
        artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        execution_target_kind: "server",
        stage: "download",
        status: "active",
        revision: 4,
        started_at_ms: 1000,
        updated_at_ms: 2000,
        completed_at_ms: null,
        error_code: null,
        error_message: null,
        counters: {
          completed_units: 500,
          total_units: 1000,
        },
      };

      const decoded = decodeCanonicalOperationSnapshot(raw);
      expect(decoded.operation_id).toBe("op-123");
      expect(decoded.artifact_id).toBe("gemma-4-e4b-it-qat-ud-q4_k_xl");
      expect(decoded.stage).toBe("download");
      expect(decoded.status).toBe("active");
      expect(decoded.revision).toBe(4);
      expect(decoded.counters.completed_units).toBe(500);
    });

    it("throws on missing operation_id or invalid stage", () => {
      expect(() =>
        decodeCanonicalOperationSnapshot({
          artifact_id: "m",
          stage: "download",
          status: "active",
        })
      ).toThrow("Invalid operation_id");

      expect(() =>
        decodeCanonicalOperationSnapshot({
          operation_id: "op-1",
          artifact_id: "m",
          stage: "unknown_stage",
          status: "active",
        })
      ).toThrow("Invalid stage");
    });
  });

  describe("decodeInferenceOperationProgressEvent", () => {
    it("decodes live operation progress event", () => {
      const raw = {
        schema_version: "inference.operation.v1",
        operation_id: "op-456",
        execution_target_kind: "server",
        artifact_id: "qwen-3.8-27b",
        stage: "verify",
        stage_instance_id: "verify-1",
        attempt_id: 1,
        status: "active",
        revision: 10,
        elapsed_ms: 1500,
        occurred_at_ms: 3500,
        counters: {},
      };

      const decoded = decodeInferenceOperationProgressEvent(raw);
      expect(decoded.operation_id).toBe("op-456");
      expect(decoded.stage).toBe("verify");
      expect(decoded.revision).toBe(10);
      expect(decoded.elapsed_ms).toBe(1500);
    });
  });

  describe("decodeRunInferenceProgressEvent", () => {
    it("decodes run inference progress event with token counters", () => {
      const raw = {
        schema_version: "run.inference.v1",
        session_id: "sess-1",
        run_id: "run-1",
        turn_index: 0,
        stage: "generate",
        stage_instance_id: "gen-0",
        attempt_id: 1,
        status: "active",
        revision: 15,
        elapsed_ms: 3200,
        occurred_at_ms: 5000,
        counters: {
          generated_tokens: 85,
          tokens_per_second: 26.5,
        },
      };

      const decoded = decodeRunInferenceProgressEvent(raw);
      expect(decoded.session_id).toBe("sess-1");
      expect(decoded.run_id).toBe("run-1");
      expect(decoded.stage).toBe("generate");
      expect(decoded.counters.generated_tokens).toBe(85);
      expect(decoded.counters.tokens_per_second).toBe(26.5);
    });
  });

  describe("decodeExecutionTarget", () => {
    it("decodes server target", () => {
      const target = decodeExecutionTarget({ kind: "server", provider_id: "local_llama" });
      expect(target).toEqual({ kind: "server", provider_id: "local_llama" });
    });

    it("decodes client_device target", () => {
      const target = decodeExecutionTarget({
        kind: "client_device",
        device_id: "dev-abc",
        model_artifact_id: "gemma-4",
        binding_revision: 2,
      });
      expect(target).toEqual({
        kind: "client_device",
        device_id: "dev-abc",
        model_artifact_id: "gemma-4",
        binding_revision: 2,
      });
    });

    it("returns undefined for invalid shapes", () => {
      expect(decodeExecutionTarget(null)).toBeUndefined();
      expect(decodeExecutionTarget({})).toBeUndefined();
      expect(decodeExecutionTarget({ kind: "unknown" })).toBeUndefined();
    });
  });

  describe("decodePublicDeviceSummary", () => {
    it("decodes active device summary", () => {
      const raw = {
        device_id: "dev-1",
        display_label: "MacBook Pro M3",
        status: "active",
        warning_archived: false,
        protocol_min_version: "1.0",
        protocol_max_version: "1.0",
        runtime_metadata: { os: "darwin", arch: "aarch64" },
        created_at: 1000,
        updated_at: 2000,
        last_seen_at: 2000,
        revision: 1,
      };

      const decoded = decodePublicDeviceSummary(raw);
      expect(decoded.device_id).toBe("dev-1");
      expect(decoded.status).toBe("active");
      expect(decoded.display_label).toBe("MacBook Pro M3");
      expect(decoded.warning_archived).toBe(false);
    });

    it("throws on invalid status", () => {
      expect(() =>
        decodePublicDeviceSummary({
          device_id: "dev-1",
          display_label: "L",
          status: "unknown_status",
        })
      ).toThrow("Invalid device status");
    });
  });

  describe("decodeModelInventoryItem", () => {
    it("decodes model item with family and installation status", () => {
      const raw = {
        artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        family: "gemma",
        display_name: "Gemma 4",
        quantization: "UD-Q4_K_XL",
        installed: true,
        installed_bytes: 4215695776,
        is_loaded: true,
        has_kv_cache: true,
        root_id: "root-1",
        active_operation_id: null,
      };

      const decoded = decodeModelInventoryItem(raw);
      expect(decoded.artifact_id).toBe("gemma-4-e4b-it-qat-ud-q4_k_xl");
      expect(decoded.family).toBe("gemma");
      expect(decoded.installed).toBe(true);
      expect(decoded.is_loaded).toBe(true);
      expect(decoded.has_kv_cache).toBe(true);
    });
  });

  describe("decodeStorageRootDescriptor", () => {
    it("decodes storage root descriptor", () => {
      const raw = {
        root_id: "root-primary",
        kind: "model_root",
        display_label: "Fast NVMe Storage",
        total_bytes: 1_000_000_000_000,
        available_bytes: 500_000_000_000,
        is_removable: false,
        is_read_only: false,
      };

      const decoded = decodeStorageRootDescriptor(raw);
      expect(decoded.root_id).toBe("root-primary");
      expect(decoded.kind).toBe("model_root");
      expect(decoded.total_bytes).toBe(1_000_000_000_000);
      expect(decoded.available_bytes).toBe(500_000_000_000);
    });
  });

  describe("decodeCatalogArtifact", () => {
    it("decodes catalog artifact with file descriptors", () => {
      const raw = {
        artifact_id: "qwen-3.8-27b",
        family: "qwen",
        display_name: "Qwen 3.8 27B",
        quantization: "UD-Q4_K_XL",
        publisher: "unsloth",
        repository: "unsloth/qwen",
        revision: "rev-1",
        files: [
          {
            filename: "model.gguf",
            size_bytes: 17559178144,
            sha256: "3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e",
            urls: ["https://example.com/model.gguf"],
          },
        ],
        license_id: "qwen-license",
        license_url: "https://example.com/license",
        requires_acceptance: true,
        context_cap: 32768,
        runtime_min_version: "0.1.0",
        recommended_ram_bytes: 34359738368,
        recommended_vram_bytes: 25769803776,
      };

      const decoded = decodeCatalogArtifact(raw);
      expect(decoded.artifact_id).toBe("qwen-3.8-27b");
      expect(decoded.family).toBe("qwen");
      expect(decoded.requires_acceptance).toBe(true);
      expect(decoded.files).toHaveLength(1);
      expect(decoded.files[0].filename).toBe("model.gguf");
    });
  });

  describe("decodeApprovePairingResponse", () => {
    it("decodes valid approve pairing response", () => {
      const raw = {
        status: "approved",
        pairing_id: "pair_abc123",
        expires_at_ms: 1700000000000,
      };
      const decoded = decodeApprovePairingResponse(raw);
      expect(decoded.status).toBe("approved");
      expect(decoded.pairing_id).toBe("pair_abc123");
      expect(decoded.expires_at_ms).toBe(1700000000000);
    });

    it("throws on missing pairing_id, status, non-positive expiry or invalid object", () => {
      expect(() => decodeApprovePairingResponse(null)).toThrow();
      expect(() => decodeApprovePairingResponse({})).toThrow();
      expect(() => decodeApprovePairingResponse({ pairing_id: "" })).toThrow();
      expect(() => decodeApprovePairingResponse({ pairing_id: "p1", status: "" })).toThrow();
      expect(() => decodeApprovePairingResponse({ pairing_id: "p1", status: "approved", expires_at_ms: 0 })).toThrow();
    });
  });

  describe("decodeStorageSelectionResponse", () => {
    it("decodes valid storage selection response", () => {
      const raw = {
        request_id: "req_xyz789",
        device_id: "dev_12345678",
        kind: "model_root",
        status: "awaiting_local_approval",
        expires_at_ms: 1700000600000,
        approved_root_id: "root_usr1",
        approved_label: "Fast SSD",
      };
      const decoded = decodeStorageSelectionResponse(raw);
      expect(decoded.request_id).toBe("req_xyz789");
      expect(decoded.device_id).toBe("dev_12345678");
      expect(decoded.kind).toBe("model_root");
      expect(decoded.status).toBe("awaiting_local_approval");
      expect(decoded.expires_at_ms).toBe(1700000600000);
      expect(decoded.approved_root_id).toBe("root_usr1");
      expect(decoded.approved_label).toBe("Fast SSD");
    });

    it("throws on missing fields, invalid kind/status or non-positive expiry", () => {
      expect(() => decodeStorageSelectionResponse(null)).toThrow();
      expect(() => decodeStorageSelectionResponse({ request_id: "req_1" })).toThrow();
      expect(() => decodeStorageSelectionResponse({ device_id: "dev_1" })).toThrow();
      expect(() => decodeStorageSelectionResponse({ request_id: "r1", device_id: "d1", kind: "unknown_kind", status: "approved", expires_at_ms: 100 })).toThrow();
      expect(() => decodeStorageSelectionResponse({ request_id: "r1", device_id: "d1", kind: "model_root", status: "invalid_status", expires_at_ms: 100 })).toThrow();
      expect(() => decodeStorageSelectionResponse({ request_id: "r1", device_id: "d1", kind: "model_root", status: "approved", expires_at_ms: -1 })).toThrow();
    });
  });

  describe("decodeExecutionTarget for pool", () => {
    it("decodes pool execution target with digest", () => {
      const target = decodeExecutionTarget({
        kind: "pool",
        pool_id: "default",
        model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        model_digest: "sha256:abc123",
        host_id: "host-1",
      });
      expect(target).toEqual({
        kind: "pool",
        pool_id: "default",
        model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        model_digest: "sha256:abc123",
        host_id: "host-1",
      });
    });

    it("decodes pool execution target input", () => {
      const input = decodeExecutionTargetInput({
        kind: "pool",
        pool_id: "default",
        model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
      });
      expect(input).toEqual({
        kind: "pool",
        pool_id: "default",
        model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        model_digest: undefined,
        host_id: undefined,
      });
    });
  });

  describe("Phase 12 entity decoders", () => {
    it("decodes PoolBinding", () => {
      const binding = decodePoolBinding({
        host_id: "h1",
        pool_id: "default",
        revision: 2,
        state: "bound",
        changed_at_ms: 1700000000,
      });
      expect(binding.host_id).toBe("h1");
      expect(binding.pool_id).toBe("default");
      expect(binding.revision).toBe(2);
      expect(binding.state).toBe("bound");
    });

    it("decodes PoolSummary", () => {
      const summary = decodePoolSummary({
        pool_id: "default",
        ready_hosts: 2,
        busy_hosts: 1,
        offline_hosts: 0,
        qualified_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl"],
      });
      expect(summary.pool_id).toBe("default");
      expect(summary.ready_hosts).toBe(2);
      expect(summary.qualified_models).toContain("gemma-4-e4b-it-qat-ud-q4_k_xl");
    });

    it("decodes HostView", () => {
      const view = decodeHostView({
        host_id: "h1",
        installation_id: "inst-1",
        label: "My Host",
        platform: "ubuntu_x86_64",
        agent_version: "0.2.0",
        lifecycle_revision: 5,
        is_connected: true,
        lease_valid: true,
        applied_binding_revision: 3,
        recovery: {
          desired_revision: 1,
          reconciled_revision: 1,
          auto_load_model: false,
          auto_prepare_kv: true,
          model_ready: true,
          cache_ready: false,
          model_action: "none",
          cache_action: "preparing",
        },
      });
      expect(view.host_id).toBe("h1");
      expect(view.is_connected).toBe(true);
      expect(view.recovery.auto_prepare_kv).toBe(true);
    });

    it("decodes HostRecoveryPreferences", () => {
      const prefs = decodeHostRecoveryPreferences({
        host_id: "h1",
        expected_revision: 2,
        reconciled_revision: 2,
        auto_load_model: false,
        auto_prepare_kv: false,
      });
      expect(prefs.auto_load_model).toBe(false);
      expect(prefs.auto_prepare_kv).toBe(false);
    });

    it("decodes HostModelRecommendation", () => {
      const rec = decodeHostModelRecommendation({
        host_id: "h1",
        artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
        fit: "fits",
        qualification: "qualified",
        perf: {
          prefill_tokens_per_second: 617,
          decode_tokens_per_second: 42,
          source: "qualification_receipt",
        },
        risks: [],
        rank: 1,
        selectable: true,
      });
      expect(rec.fit).toBe("fits");
      expect(rec.selectable).toBe(true);
      expect(rec.perf.source).toBe("qualification_receipt");
    });

    it("decodes HostCacheStatus", () => {
      const cache = decodeHostCacheStatus({
        host_id: "h1",
        scope_key: "scope-abc",
        status: "ready",
        committed_tokens: 2048,
        total_tokens: 2048,
        invalidation_revision: 1,
      });
      expect(cache.status).toBe("ready");
      expect(cache.committed_tokens).toBe(2048);
    });

    it("decodes OperatorRecoveryView", () => {
      const opView = decodeOperatorRecoveryView({
        request_id: "rec-1",
        deployment_id: "dep-1",
        installation_id: "inst-1",
        host_id: "h1",
        public_key_fingerprint: "sha256:fp",
        requested_credential_generation: 2,
        expiry_ms: 170000600000,
        status: "pending_approval",
        approval_revision: 1,
        created_at_ms: 170000000000,
      });
      expect(opView.status).toBe("pending_approval");
      expect(opView.public_key_fingerprint).toBe("sha256:fp");
    });
  });
});
