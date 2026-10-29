import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CanonicalOperationSnapshot,
  RunInferenceProgressEvent,
} from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "./inferenceStore.js";
import { useReadinessStore } from "./readinessStore.js";
import { setInferenceService } from "../adapters/factory/ServiceFactory.js";
import type { IInferenceService } from "../adapters/factory/interfaces/IInferenceService.js";

const mockInferenceService = {
  saveRecoveryPreferences: vi.fn(),
  dispatchModelOperation: vi.fn(),
  getOperation: vi.fn(),
  fetchHosts: vi.fn(),
  listHosts: vi.fn().mockResolvedValue([]),
  listHostOperations: vi.fn().mockResolvedValue([]),
  listHostModels: vi.fn().mockResolvedValue([]),
} as unknown as IInferenceService;
setInferenceService(mockInferenceService);
describe("inferenceStore", () => {
  beforeEach(() => {
    useInferenceStore.getState().invalidateAccess();
  });

  describe("monotonic operation revision fences", () => {
    it("accepts higher revisions and ignores stale or older revisions for the same operation", () => {
      const store = useInferenceStore.getState();

      const snapshotRev5: CanonicalOperationSnapshot = {
        operation_id: "op-1",
        artifact_id: "gemma-4",
        execution_target_kind: "server",
        stage: "download",
        status: "active",
        revision: 5,
        started_at_ms: 100,
        updated_at_ms: 500,
        counters: { completed_units: 500, total_units: 1000 },
      };

      store.applyOperationSnapshot(snapshotRev5);
      expect(useInferenceStore.getState().operations["op-1"].revision).toBe(5);
      expect(useInferenceStore.getState().operations["op-1"].counters.completed_units).toBe(500);

      // Stale revision: 4
      const snapshotRev4: CanonicalOperationSnapshot = {
        operation_id: "op-1",
        artifact_id: "gemma-4",
        execution_target_kind: "server",
        stage: "download",
        status: "active",
        revision: 4,
        started_at_ms: 100,
        updated_at_ms: 400,
        counters: { completed_units: 400, total_units: 1000 },
      };

      useInferenceStore.getState().applyOperationSnapshot(snapshotRev4);
      // Value should remain at revision 5
      expect(useInferenceStore.getState().operations["op-1"].revision).toBe(5);
      expect(useInferenceStore.getState().operations["op-1"].counters.completed_units).toBe(500);

      // Newer revision: 6
      const snapshotRev6: CanonicalOperationSnapshot = {
        ...snapshotRev5,
        revision: 6,
        counters: { completed_units: 600, total_units: 1000 },
      };

      useInferenceStore.getState().applyOperationSnapshot(snapshotRev6);
      expect(useInferenceStore.getState().operations["op-1"].revision).toBe(6);
      expect(useInferenceStore.getState().operations["op-1"].counters.completed_units).toBe(600);
    });

    it("discards operation snapshots from an invalidated context key", () => {
      const store = useInferenceStore.getState();
      const currentKey = store.accessKey;

      const snapshot: CanonicalOperationSnapshot = {
        operation_id: "op-2",
        artifact_id: "qwen",
        execution_target_kind: "server",
        stage: "download",
        status: "active",
        revision: 1,
        started_at_ms: 100,
        updated_at_ms: 200,
        counters: {},
      };

      // Discarded when contextKey does not match
      store.applyOperationSnapshot(snapshot, "stale-context-key-123");
      expect(useInferenceStore.getState().operations["op-2"]).toBeUndefined();

      // Accepted when contextKey matches
      store.applyOperationSnapshot(snapshot, currentKey);
      expect(useInferenceStore.getState().operations["op-2"]).toBeDefined();
    });
  });

  describe("run inference progress scoping", () => {
    it("tracks run progress by session, run, and turn index", () => {
      const store = useInferenceStore.getState();

      const eventRev1: RunInferenceProgressEvent = {
        schema_version: "run.inference.v1",
        session_id: "sess-1",
        run_id: "run-1",
        turn_index: 0,
        stage: "generate",
        stage_instance_id: "gen-0",
        attempt_id: 1,
        status: "active",
        revision: 1,
        elapsed_ms: 500,
        occurred_at_ms: 1000,
        counters: { generated_tokens: 10 },
      };

      store.applyRunProgressEvent(eventRev1);
      const key = "sess-1:run-1:0";
      expect(useInferenceStore.getState().runProgress[key].counters.generated_tokens).toBe(10);

      // Stale revision ignored
      store.applyRunProgressEvent({
        ...eventRev1,
        revision: 0,
        counters: { generated_tokens: 5 },
      });
      expect(useInferenceStore.getState().runProgress[key].counters.generated_tokens).toBe(10);

      // Newer revision applied
      store.applyRunProgressEvent({
        ...eventRev1,
        revision: 2,
        counters: { generated_tokens: 25 },
      });
      expect(useInferenceStore.getState().runProgress[key].counters.generated_tokens).toBe(25);

      // Clear run progress for session
      useInferenceStore.getState().clearRunProgress("sess-1");
      expect(useInferenceStore.getState().runProgress[key]).toBeUndefined();
    });
  });

  describe("getTargetReadiness", () => {
    it("returns Server readiness when target is omitted or server kind", () => {
      useReadinessStore.setState({
        phase: "ready",
        canInfer: true,
        error: null,
      });

      const readiness = useInferenceStore.getState().getTargetReadiness({ kind: "server", provider_id: "local_llama" });
      expect(readiness.canInfer).toBe(true);
      expect(readiness.isReady).toBe(true);
      expect(readiness.phase).toBe("ready");
      expect(readiness.label).toBe("Server");
    });

    it("evaluates paired device readiness correctly", () => {
      useInferenceStore.setState({
        devices: [
          {
            device_id: "dev-active",
            display_label: "My M3 Laptop",
            status: "active",
            warning_archived: false,
            protocol_min_version: "1.0",
            protocol_max_version: "1.0",
            runtime_metadata: {},
            created_at: 100,
            updated_at: 200,
            revision: 1,
          },
          {
            device_id: "dev-revoked",
            display_label: "Old Desktop",
            status: "revoked",
            warning_archived: false,
            protocol_min_version: "1.0",
            protocol_max_version: "1.0",
            runtime_metadata: {},
            created_at: 100,
            updated_at: 200,
            revision: 1,
          },
        ],
      });

      // Active device
      const activeReadiness = useInferenceStore.getState().getTargetReadiness({
        kind: "client_device",
        device_id: "dev-active",
        model_artifact_id: "gemma-4",
        binding_revision: 1,
      });
      expect(activeReadiness.canInfer).toBe(true);
      expect(activeReadiness.isReady).toBe(true);
      expect(activeReadiness.phase).toBe("ready");
      expect(activeReadiness.label).toBe("My M3 Laptop");

      // Revoked device
      const revokedReadiness = useInferenceStore.getState().getTargetReadiness({
        kind: "client_device",
        device_id: "dev-revoked",
        model_artifact_id: "gemma-4",
        binding_revision: 1,
      });
      expect(revokedReadiness.canInfer).toBe(false);
      expect(revokedReadiness.isReady).toBe(false);
      expect(revokedReadiness.phase).toBe("failed");
      expect(revokedReadiness.reason).toBe("Device is revoked");

      // Missing / offline device
      const missingReadiness = useInferenceStore.getState().getTargetReadiness({
        kind: "client_device",
        device_id: "non-existent-device",
        model_artifact_id: "gemma-4",
        binding_revision: 1,
      });
      expect(missingReadiness.canInfer).toBe(false);
      expect(missingReadiness.isReady).toBe(false);
      expect(missingReadiness.phase).toBe("offline");
    });

    it("evaluates pool target readiness correctly", () => {
      useInferenceStore.setState({
        pools: {
          ready_pool: {
            pool_id: "ready_pool",
            ready_hosts: 2,
            busy_hosts: 0,
            offline_hosts: 0,
            qualified_models: ["gemma-4"],
          },
          empty_pool: {
            pool_id: "empty_pool",
            ready_hosts: 0,
            busy_hosts: 1,
            offline_hosts: 1,
            qualified_models: [],
          },
        },
      });

      const ready = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "ready_pool",
        model_artifact_id: "gemma-4",
        model_digest: "sha256:abc",
      });
      expect(ready.canInfer).toBe(true);
      expect(ready.isReady).toBe(true);
      expect(ready.phase).toBe("ready");
      expect(ready.label).toBe("Pool: ready_pool");

      const empty = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "empty_pool",
        model_artifact_id: "gemma-4",
        model_digest: "sha256:abc",
      });
      expect(empty.canInfer).toBe(false);
      expect(empty.isReady).toBe(false);
      expect(empty.phase).toBe("offline");
      expect(empty.reason).toBe("No ready hosts in pool");
    });
  });

  describe("Phase 12 store event handlers", () => {
    it("applyHostUpdatedEvent updates host and respects monotonic revision", () => {
      useInferenceStore.setState({
        hosts: {
          h1: {
            host_id: "h1",
            installation_id: "i1",
            label: "Host 1",
            platform: "ubuntu_x86_64",
            agent_version: "0.2.0",
            lifecycle_revision: 5,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 2,
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
        },
      });

      // Stale event (revision 4 < 5)
      useInferenceStore.getState().applyHostUpdatedEvent({
        host_id: "h1",
        revision: 4,
        is_connected: false,
      });
      expect(useInferenceStore.getState().hosts.h1.is_connected).toBe(true);

      // Newer event (revision 6 > 5)
      useInferenceStore.getState().applyHostUpdatedEvent({
        host_id: "h1",
        revision: 6,
        is_connected: false,
      });
      expect(useInferenceStore.getState().hosts.h1.is_connected).toBe(false);
      expect(useInferenceStore.getState().hosts.h1.lifecycle_revision).toBe(6);
    });

    it("applyBindingUpdatedEvent updates binding revision", () => {
      useInferenceStore.setState({
        hosts: {
          h1: {
            host_id: "h1",
            installation_id: "i1",
            label: "Host 1",
            platform: "ubuntu_x86_64",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 3,
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
        },
      });

      // Stale binding (revision 2 < 3)
      useInferenceStore.getState().applyBindingUpdatedEvent({
        host_id: "h1",
        pool_id: "default",
        revision: 2,
        state: "bound",
      });
      expect(useInferenceStore.getState().hosts.h1.applied_binding_revision).toBe(3);

      // Newer binding (revision 4 > 3)
      useInferenceStore.getState().applyBindingUpdatedEvent({
        host_id: "h1",
        pool_id: "default",
        revision: 4,
        state: "bound",
      });
      expect(useInferenceStore.getState().hosts.h1.applied_binding_revision).toBe(4);
      expect(useInferenceStore.getState().hosts.h1.current_binding?.pool_id).toBe("default");
    });

    it("applyPoolUpdatedEvent updates pool metrics", () => {
      useInferenceStore.setState({
        pools: {
          p1: {
            pool_id: "p1",
            ready_hosts: 1,
            busy_hosts: 0,
            offline_hosts: 0,
            qualified_models: [],
          },
        },
      });

      useInferenceStore.getState().applyPoolUpdatedEvent({
        pool_id: "p1",
        ready_hosts: 3,
        busy_hosts: 2,
      });
      expect(useInferenceStore.getState().pools.p1.ready_hosts).toBe(3);
      expect(useInferenceStore.getState().pools.p1.busy_hosts).toBe(2);
    });

    it("applyRecoveryUpdatedEvent updates credential recovery status", () => {
      useInferenceStore.setState({
        credentialRecoveries: {
          req_1: {
            request_id: "req_1",
            deployment_id: "dep",
            installation_id: "inst",
            host_id: "h1",
            public_key_fingerprint: "fp",
            requested_credential_generation: 1,
            expiry_ms: 10000,
            status: "pending_approval",
            approval_revision: 1,
            created_at_ms: 1000,
          },
        },
      });

      useInferenceStore.getState().applyRecoveryUpdatedEvent({
        request_id: "req_1",
        host_id: "h1",
        status: "approved",
        approval_revision: 2,
      });
      expect(useInferenceStore.getState().credentialRecoveries.req_1.status).toBe("approved");
      expect(useInferenceStore.getState().credentialRecoveries.req_1.approval_revision).toBe(2);
    });

    it("guards hostPreferences against regressing revisions", async () => {
      const initialPrefs = {
        host_id: "h1",
        auto_load_model: false,
        auto_prepare_kv: false,
        expected_revision: 5,
        reconciled_revision: 5,
      };
      useInferenceStore.setState({
        hostPreferences: {
          h1: initialPrefs,
        },
      });

      // Attempt to save an older revision (e.g. out of order response)
      const stalePrefs = {
        host_id: "h1",
        auto_load_model: true,
        auto_prepare_kv: true,
        expected_revision: 3,
        reconciled_revision: 3,
      };
      mockInferenceService.saveRecoveryPreferences = vi.fn().mockResolvedValue(stalePrefs);

      await useInferenceStore.getState().saveRecoveryPreferences("h1", {
        auto_load_model: true,
        auto_prepare_kv: true,
        expected_revision: 3,
      });

      // State must retain reconciled_revision 5
      expect(useInferenceStore.getState().hostPreferences.h1.reconciled_revision).toBe(5);
      expect(useInferenceStore.getState().hostPreferences.h1.auto_load_model).toBe(false);
    });

    it("records and bounds dispatched mutations in sessionStorage", async () => {
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({
        operation_id: "op-test-1",
      });
      mockInferenceService.getOperation = vi.fn().mockResolvedValue({
        operation_id: "op-test-1",
        artifact_id: "gemma-4",
        execution_target_kind: "server",
        stage: "load_weights",
        status: "active",
        revision: 1,
        occurred_at_ms: Date.now(),
        elapsed_ms: 100,
      });

      const opId = await useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", {
        kind: "load",
      });

      expect(opId).toBe("op-test-1");
      const mutations = useInferenceStore.getState().persistedMutations;
      const entries = Object.values(mutations);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[entries.length - 1].artifactId).toBe("gemma-4");
      expect(entries[entries.length - 1].hostId).toBe("h1");
    });

    it("merges independently advancing desired vs reconciled revisions", async () => {
      useInferenceStore.setState({
        hostPreferences: {
          h1: {
            host_id: "h1",
            auto_load_model: true,
            auto_prepare_kv: true,
            expected_revision: 6,
            reconciled_revision: 5,
          },
        },
      });

      // Stale desired revision 5 arrives with equal reconciled revision 5
      mockInferenceService.getRecoveryPreferences = vi.fn().mockResolvedValue({
        host_id: "h1",
        auto_load_model: false,
        auto_prepare_kv: false,
        expected_revision: 5,
        reconciled_revision: 5,
      });

      await useInferenceStore.getState().fetchHostPreferences("h1");

      const pref = useInferenceStore.getState().hostPreferences.h1;
      expect(pref.expected_revision).toBe(6);
      expect(pref.auto_load_model).toBe(true);
      expect(pref.reconciled_revision).toBe(5);
    });

    it("prunes terminal mutations and reconciles lost POST mutations", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "mut-terminal": {
            mutationId: "mut-terminal",
            hostId: "h1",
            kind: "load",
            status: "completed",
            timestamp: Date.now(),
          },
          "mut-lost-post": {
            mutationId: "mut-lost-post",
            hostId: "h1",
            kind: "load",
            timestamp: Date.now(),
          },
        },
      });

      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([
        {
          operation_id: "mut-lost-post",
          state: "active",
          stage: "load_weights",
        },
      ]);
      mockInferenceService.getOperation = vi.fn().mockResolvedValue({
        operation_id: "mut-lost-post",
        state: "active",
        revision: 1,
      });

      await useInferenceStore.getState().reconcilePersistedMutations();

      const mutations = useInferenceStore.getState().persistedMutations;
      expect(mutations["mut-terminal"]).toBeUndefined();
      expect(mutations["mut-lost-post"]).toBeDefined();
      expect(mutations["mut-lost-post"].operationId).toBe("mut-lost-post");
    });
  });
});
