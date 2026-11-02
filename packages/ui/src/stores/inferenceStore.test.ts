// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppSourceRef,
  CanonicalOperationSnapshot,
  OperationSnapshot,
  RunInferenceProgressEvent,
  WorkerLoadProfile,
} from "@eigen-air-ui/shared/types";
import { useInferenceStore, type PersistedMutation } from "./inferenceStore.js";
import { useReadinessStore } from "./readinessStore.js";
import {
  setInferenceService,
  setServiceDeploymentId,
  setServiceAccessContext,
  resetServiceFactoryState,
} from "../adapters/factory/ServiceFactory.js";
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
    resetServiceFactoryState();
    setInferenceService(mockInferenceService);
    setServiceDeploymentId("http://127.0.0.1:18790");
    setServiceAccessContext({ identityKey: "test-user-1" });
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
        hosts: {
          "h-ready": {
            host_id: "h-ready",
            installation_id: "i-ready",
            label: "Ready Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            current_binding: {
              host_id: "h-ready",
              pool_id: "ready_pool",
              state: "bound",
              revision: 1,
              changed_at_ms: 1000,
            },
            recovery: {
              desired_revision: 1,
              reconciled_revision: 1,
              auto_load_model: true,
              auto_prepare_kv: false,
              model_ready: true,
              cache_ready: true,
              model_action: "none",
              cache_action: "none",
            },
          },
        },
      });

      const ready = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "ready_pool",
        model_artifact_id: "gemma-4",
        model_digest: "e8b6a059ba86947a44ace84d6e5679795bc41862c25c30513142588f0e9dba1d",
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

    it("UI-02: fetchHostOperations correctly maps status and syncs operations and hostOperations", async () => {
      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([
        {
          operation_id: "op-ind",
          host_id: "host-1",
          artifact_id: "gemma-4",
          kind: "load",
          state: "indeterminate",
          stage: "verify",
          revision: 2,
          counters: {},
        },
        {
          operation_id: "op-q",
          host_id: "host-1",
          artifact_id: "gemma-4",
          kind: "load",
          state: "queued",
          stage: "queue",
          revision: 1,
          counters: {},
        },
      ]);

      await useInferenceStore.getState().fetchHostOperations("host-1");

      const ops = useInferenceStore.getState().operations;
      expect(ops["op-ind"].status).toBe("indeterminate");
      expect(ops["op-q"].status).toBe("pending");

      const hostOps = useInferenceStore.getState().hostOperations["host-1"];
      expect(hostOps.length).toBe(2);
      expect(hostOps.find((o) => o.operation_id === "op-ind")?.state).toBe("indeterminate");
    });

    it("UI-02: pollActiveOperation treats indeterminate as terminal and stops polling", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "mut-ind": {
            mutationId: "mut-ind",
            operationId: "op-ind-poll",
            hostId: "host-1",
            kind: "load",
            timestamp: Date.now(),
          },
        },
        hostOperations: {
          "host-1": [
            {
              operation_id: "op-ind-poll",
              host_id: "host-1",
              artifact_id: "gemma-4",
              kind: "load",
              state: "running",
              revision: 1,
              counters: {},
            },
          ],
        },
      });

      mockInferenceService.getOperation = vi.fn().mockResolvedValue({
        operation_id: "op-ind-poll",
        host_id: "host-1",
        artifact_id: "gemma-4",
        kind: "load",
        state: "indeterminate",
        revision: 2,
        counters: {},
      });

      await useInferenceStore.getState().pollActiveOperation("op-ind-poll");

      // Persisted mutation must be pruned on indeterminate
      expect(useInferenceStore.getState().persistedMutations["mut-ind"]).toBeUndefined();
      // hostOperations must be updated
      const hostOp = useInferenceStore.getState().hostOperations["host-1"].find((o) => o.operation_id === "op-ind-poll");
      expect(hostOp?.state).toBe("indeterminate");
      expect(hostOp?.revision).toBe(2);
    });

    it("UI-03: fetchInstallation triggers fetchHosts only when status/connectivity changes", async () => {
      const fetchHostsSpy = vi.spyOn(useInferenceStore.getState(), "fetchHosts");

      mockInferenceService.getInstallation = vi.fn().mockResolvedValue({
        installation_id: "inst-gw-10",
        platform: "linux-x86_64",
        label: "Node 10",
        status: "pending",
        enrolled: false,
        connected: false,
        host_id: null,
        created_at_ms: 1000,
      });

      await useInferenceStore.getState().fetchInstallation("inst-gw-10");
      expect(fetchHostsSpy).not.toHaveBeenCalled();

      // Now enrolled & connected -> triggers fetchHosts
      mockInferenceService.getInstallation = vi.fn().mockResolvedValue({
        installation_id: "inst-gw-10",
        platform: "linux-x86_64",
        label: "Node 10",
        status: "connected",
        enrolled: true,
        connected: true,
        host_id: "host-10",
        created_at_ms: 1000,
      });

      await useInferenceStore.getState().fetchInstallation("inst-gw-10");
      expect(fetchHostsSpy).toHaveBeenCalledTimes(1);
      // If host is not yet populated, subsequent poll retries correlation (W4)
      await useInferenceStore.getState().fetchInstallation("inst-gw-10");
      expect(fetchHostsSpy).toHaveBeenCalledTimes(2);

      // Once correlated host is hydrated into store, unchanged polls do NOT call fetchHosts again
      useInferenceStore.setState((s) => ({
        hosts: {
          ...s.hosts,
          "host-10": {
            host_id: "host-10",
            installation_id: "inst-gw-10",
            label: "Node 10",
            platform: "linux-x86_64",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 0,
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
      }));

      await useInferenceStore.getState().fetchInstallation("inst-gw-10");
      expect(fetchHostsSpy).toHaveBeenCalledTimes(2);
    });

    it("UI-04: mergeHostRecoveryStatus merges desired and observed concerns independently", async () => {
      useInferenceStore.setState({
        hosts: {
          "h-rec": {
            host_id: "h-rec",
            installation_id: "i-rec",
            label: "Recovery Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 5,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            recovery: {
              desired_revision: 6,
              reconciled_revision: 5,
              auto_load_model: false,
              auto_prepare_kv: false,
              model_ready: true,
              cache_ready: false,
              model_action: "none",
              cache_action: "none",
            },
          },
        },
      });

      // Delayed list response with higher lifecycle revision (7 > 5) but older desired revision (5 < 6)
      // and newer observed revision (6 > 5) with model_ready = false
      mockInferenceService.listHosts = vi.fn().mockResolvedValue([
        {
          host_id: "h-rec",
          installation_id: "i-rec",
          label: "Recovery Host",
          platform: "linux",
          agent_version: "0.2.0",
          lifecycle_revision: 7,
          last_seen_at_ms: 2000,
          is_connected: true,
          lease_valid: true,
          applied_binding_revision: 1,
          recovery: {
            desired_revision: 5, // older than 6
            reconciled_revision: 6, // newer than 5
            auto_load_model: true, // should NOT overwrite existing false
            auto_prepare_kv: false,
            model_ready: false, // should overwrite because reconciled 6 > 5
            cache_ready: true,
            model_action: "loading",
            cache_action: "none",
          },
        },
      ]);

      await useInferenceStore.getState().fetchHosts();

      const host = useInferenceStore.getState().hosts["h-rec"];
      expect(host.lifecycle_revision).toBe(7);
      // Desired kept from existing (desired_revision: 6, auto_load_model: false)
      expect(host.recovery.desired_revision).toBe(6);
      expect(host.recovery.auto_load_model).toBe(false);
      // Observed updated from incoming (reconciled_revision: 6, model_ready: false, cache_ready: true)
      expect(host.recovery.reconciled_revision).toBe(6);
      expect(host.recovery.model_ready).toBe(false);
      expect(host.recovery.cache_ready).toBe(true);
    });

    it("UI-07: getTargetReadiness verifies model qualification and pinned host binding", () => {
      useInferenceStore.setState({
        pools: {
          "p-strict": {
            pool_id: "p-strict",
            ready_hosts: 1,
            busy_hosts: 0,
            offline_hosts: 0,
            qualified_models: ["qwen-3.5-9b-ud-q4_k_xl"],
          },
        },
        hosts: {
          "h-bound": {
            host_id: "h-bound",
            installation_id: "i1",
            label: "Bound Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            current_binding: {
              host_id: "h-bound",
              pool_id: "p-strict",
              state: "bound",
              revision: 1,
              changed_at_ms: 1000,
            },
            recovery: {
              desired_revision: 1,
              reconciled_revision: 1,
              auto_load_model: false,
              auto_prepare_kv: false,
              model_ready: true,
              cache_ready: true,
              model_action: "none",
              cache_action: "none",
            },
          },
          "h-unbound": {
            host_id: "h-unbound",
            installation_id: "i2",
            label: "Unbound Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            current_binding: null,
            recovery: {
              desired_revision: 1,
              reconciled_revision: 1,
              auto_load_model: false,
              auto_prepare_kv: false,
              model_ready: true,
              cache_ready: true,
              model_action: "none",
              cache_action: "none",
            },
          },
        },
      });

      // Target model not in pool.qualified_models -> offline
      const unqual = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "p-strict",
        model_artifact_id: "gemma-4-unsupported",
        model_digest: "sha256:mock",
      });
      expect(unqual.isReady).toBe(false);
      expect(unqual.phase).toBe("offline");
      expect(unqual.reason).toContain("not qualified");

      // Target model qualified and pinned host bound and connected -> ready
      // Target model qualified and pinned host bound, connected, and model-ready -> ready
      const qwenDigest = "6f5d30666c2d8ae16a306e616d95341dcf3cc46810df84d7e6f5a7d1e4c1b293";
      const qualPinned = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "p-strict",
        model_artifact_id: "qwen-3.5-9b-ud-q4_k_xl",
        model_digest: qwenDigest,
        host_id: "h-bound",
      });
      expect(qualPinned.isReady).toBe(true);
      expect(qualPinned.phase).toBe("ready");
      // Pinned host not bound to pool -> offline
      const unboundPinned = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "p-strict",
        model_artifact_id: "qwen-3.5-9b-ud-q4_k_xl",
        model_digest: qwenDigest,
        host_id: "h-unbound",
      });
      expect(unboundPinned.isReady).toBe(false);
      expect(unboundPinned.phase).toBe("offline");
      expect(unboundPinned.reason).toContain("not bound");
    });

    it("UI-07: getTargetReadiness catches model_digest mismatch and unready host recovery", () => {
      useInferenceStore.setState({
        pools: {
          "p-strict": {
            pool_id: "p-strict",
            ready_hosts: 1,
            busy_hosts: 0,
            offline_hosts: 0,
            qualified_models: ["qwen-3.5-9b-ud-q4_k_xl"],
          },
        },
        hosts: {
          "h-unready": {
            host_id: "h-unready",
            installation_id: "i1",
            label: "Unready Model Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 1,
            last_seen_at_ms: 1000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            current_binding: {
              host_id: "h-unready",
              pool_id: "p-strict",
              state: "bound",
              revision: 1,
              changed_at_ms: 1000,
            },
            recovery: {
              desired_revision: 1,
              reconciled_revision: 1,
              auto_load_model: true,
              auto_prepare_kv: false,
              model_ready: false, // NOT ready yet
              cache_ready: false,
              model_action: "loading",
              cache_action: "none",
            },
          },
        },
      });

      // Digest mismatch against authoritative catalog
      const badDigest = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "p-strict",
        model_artifact_id: "qwen-3.5-9b-ud-q4_k_xl",
        model_digest: "sha256:corrupted_digest",
        host_id: "h-unready",
      });
      expect(badDigest.isReady).toBe(false);
      expect(badDigest.phase).toBe("offline");
      expect(badDigest.reason).toContain("digest mismatch");

      // Correct digest, but pinned host recovery model_ready === false
      const qwenDigest = "6f5d30666c2d8ae16a306e616d95341dcf3cc46810df84d7e6f5a7d1e4c1b293";
      const unreadyHost = useInferenceStore.getState().getTargetReadiness({
        kind: "pool",
        pool_id: "p-strict",
        model_artifact_id: "qwen-3.5-9b-ud-q4_k_xl",
        model_digest: qwenDigest,
        host_id: "h-unready",
      });
      expect(unreadyHost.isReady).toBe(false);
      expect(unreadyHost.phase).toBe("offline");
      expect(unreadyHost.reason).toContain("not model-ready");
    });

    it("UI-04: mergeHostRecoveryStatus guards against older lifecycle messages with equal reconciled revision", async () => {
      useInferenceStore.setState({
        hosts: {
          "h-clock": {
            host_id: "h-clock",
            installation_id: "i-clock",
            label: "Clock Host",
            platform: "linux",
            agent_version: "0.2.0",
            lifecycle_revision: 10,
            last_seen_at_ms: 2000,
            is_connected: true,
            lease_valid: true,
            applied_binding_revision: 1,
            recovery: {
              desired_revision: 5,
              reconciled_revision: 5,
              auto_load_model: false,
              auto_prepare_kv: false,
              model_ready: false, // current authoritative observed state at lifecycle 10
              cache_ready: false,
              model_action: "none",
              cache_action: "none",
            },
          },
        },
      });

      // A delayed event from lifecycle 9 with equal reconciled revision 5 and model_ready: true
      useInferenceStore.getState().applyHostUpdatedEvent({
        host_id: "h-clock",
        revision: 9, // older lifecycle revision
        recovery: {
          desired_revision: 5,
          reconciled_revision: 5,
          auto_load_model: false,
          auto_prepare_kv: false,
          model_ready: true, // stale observation from older message!
          cache_ready: false,
          model_action: "none",
          cache_action: "none",
        },
      });

      const host = useInferenceStore.getState().hosts["h-clock"];
      expect(host.lifecycle_revision).toBe(10);
      // model_ready must remain false; older lifecycle message cannot regress it
      expect(host.recovery.model_ready).toBe(false);

      // A newer event at lifecycle 11 with model_ready: true updates readiness without being frozen
      useInferenceStore.getState().applyHostUpdatedEvent({
        host_id: "h-clock",
        revision: 11,
        recovery: {
          desired_revision: 5,
          reconciled_revision: 5,
          auto_load_model: false,
          auto_prepare_kv: false,
          model_ready: true,
          cache_ready: false,
          model_action: "none",
          cache_action: "none",
        },
      });
      expect(useInferenceStore.getState().hosts["h-clock"].recovery.model_ready).toBe(true);
    });

    it("UI-02: unknown operation hints and revision gaps trigger authoritative polling", () => {
      const pollSpy = vi.spyOn(useInferenceStore.getState(), "pollActiveOperation").mockResolvedValue();

      // Sparse event for unknown operation ID
      useInferenceStore.getState().applyOperationEvent({
        operation_id: "op-unknown-1",
        state: "running",
        revision: 1,
      });
      expect(pollSpy).toHaveBeenCalledWith("op-unknown-1");

      // Progress event for known operation with a revision gap (revision 5 vs existing 2)
      useInferenceStore.setState({
        operations: {
          "op-gap-1": {
            operation_id: "op-gap-1",
            artifact_id: "gemma-4",
            execution_target_kind: "server",
            stage: "download",
            status: "active",
            revision: 2,
            started_at_ms: 1000,
            updated_at_ms: 1000,
            counters: {},
          },
        },
      });

      useInferenceStore.getState().applyOperationEvent({
        schema_version: "inference.operation.v1",
        operation_id: "op-gap-1",
        execution_target_kind: "server",
        artifact_id: "gemma-4",
        stage: "verify",
        attempt_id: 1,
        status: "active",
        revision: 5, // Gap: 5 > 2 + 1
        elapsed_ms: 1000,
        occurred_at_ms: 2000,
        counters: {},
      });
      expect(pollSpy).toHaveBeenCalledWith("op-gap-1");
    });
    it("UI-01: isolates mutations and active installation ID between daemon A and daemon B", async () => {
      setServiceDeploymentId("http://daemon-a:18790");
      setServiceAccessContext({ identityKey: "user-alpha" });
      useInferenceStore.getState().invalidateAccess();

      useInferenceStore.getState().setActiveInstallationId("inst-daemon-a");
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({ operation_id: "op-a" });
      await useInferenceStore.getState().dispatchModelOperation("host-a", "gemma-4", {
        kind: "load",
        mutation_id: "mut-a",
      });

      // Switch to Daemon B with same user identity
      setServiceDeploymentId("http://daemon-b:18790");
      useInferenceStore.getState().invalidateAccess();

      // Daemon B must NOT hydrate Daemon A's installation or mutations
      expect(useInferenceStore.getState().activeInstallationId).toBeNull();
      expect(useInferenceStore.getState().persistedMutations).toEqual({});

      // Set Daemon B data
      useInferenceStore.getState().setActiveInstallationId("inst-daemon-b");

      // Switch back to Daemon A
      setServiceDeploymentId("http://daemon-a:18790");
      useInferenceStore.getState().invalidateAccess();

      // Daemon A's data remains intact and isolated
      expect(useInferenceStore.getState().activeInstallationId).toBe("inst-daemon-a");
      expect(useInferenceStore.getState().persistedMutations["mut-a"]).toBeDefined();
    });

    it("UI-01: fails closed when persistence scope is unknown", () => {
      resetServiceFactoryState(); // no deploymentId, no identityKey
      setInferenceService(mockInferenceService);
      useInferenceStore.getState().invalidateAccess();

      useInferenceStore.getState().setActiveInstallationId("unscoped-inst");
      expect(useInferenceStore.getState().activeInstallationId).toBe("unscoped-inst");

      // Invalidation with unknown scope cannot read or write to any persistent bucket
      useInferenceStore.getState().invalidateAccess();
      expect(useInferenceStore.getState().activeInstallationId).toBeNull();
      expect(useInferenceStore.getState().persistedMutations).toEqual({});
      expect(sessionStorage.getItem("eigen-air:active-installation-id")).toBeNull();
    });

    it("UI-05: enforces 50-entry live insertion bound and refuses 51st without silent eviction", async () => {
      const store = useInferenceStore.getState();
      const now = Date.now();
      const existingMutations: Record<string, PersistedMutation> = {};
      for (let i = 1; i <= 50; i++) {
        existingMutations[`mut-${i}`] = {
          mutationId: `mut-${i}`,
          hostId: "h1",
          kind: "load",
          status: "pending_dispatch",
          timestamp: now - 1000,
        };
      }
      useInferenceStore.setState({ persistedMutations: existingMutations });

      await expect(
        store.dispatchModelOperation("h1", "gemma-4", { kind: "load" })
      ).rejects.toThrow(/Mutation capacity exceeded/i);

      // Verify all 50 mutations are still preserved and none were silently evicted
      const mutations = useInferenceStore.getState().persistedMutations;
      expect(Object.keys(mutations).length).toBe(50);
      expect(mutations["mut-1"]).toBeDefined();
      expect(mutations["mut-50"]).toBeDefined();
    });

    it("UI-05: deduplicates host operations queries when multiple pending mutations share the same host", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "mut-h1-a": {
            mutationId: "mut-h1-a",
            hostId: "host-shared",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
          },
          "mut-h1-b": {
            mutationId: "mut-h1-b",
            hostId: "host-shared",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
          },
          "mut-h1-c": {
            mutationId: "mut-h1-c",
            hostId: "host-shared",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
          },
        },
      });

      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([]);

      await useInferenceStore.getState().reconcilePersistedMutations();

      // listHostOperations must be called exactly ONCE for host-shared
      expect(mockInferenceService.listHostOperations).toHaveBeenCalledTimes(1);
      expect(mockInferenceService.listHostOperations).toHaveBeenCalledWith("host-shared");
    });

    it("UI-05: deduplicates concurrent in-flight reconciliation calls", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "mut-conc": {
            mutationId: "mut-conc",
            hostId: "host-conc",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
          },
        },
      });

      let resolveOps!: (val: OperationSnapshot[]) => void;
      const deferredPromise = new Promise<OperationSnapshot[]>((resolve) => {
        resolveOps = resolve;
      });
      mockInferenceService.listHostOperations = vi.fn().mockReturnValue(deferredPromise);

      // Start two reconciliations concurrently
      const p1 = useInferenceStore.getState().reconcilePersistedMutations();
      const p2 = useInferenceStore.getState().reconcilePersistedMutations();

      resolveOps([]);
      await Promise.all([p1, p2]);

      expect(mockInferenceService.listHostOperations).toHaveBeenCalledTimes(1);
    });

    it("UI-05: bounds runProgress retention to 50 entries, pruning terminal/oldest entries", () => {
      const store = useInferenceStore.getState();
      for (let i = 1; i <= 55; i++) {
        store.applyRunProgressEvent({
          schema_version: "inference.progress.v1",
          session_id: "s1",
          run_id: `run-${i}`,
          turn_index: 0,
          stage: "load_context",
          stage_instance_id: `stage-${i}`,
          attempt_id: 1,
          status: i <= 5 ? "completed" : "active",
          revision: 1,
          elapsed_ms: 10,
          occurred_at_ms: i * 100,
          counters: {},
        });
      }

      const progress = useInferenceStore.getState().runProgress;
      expect(Object.keys(progress).length).toBeLessThanOrEqual(50);
      // Terminal runs 1-5 should have been pruned first
      expect(progress["s1:run-1:0"]).toBeUndefined();
    });

    it("UI-10: persists exact allowlisted nonsecret request fields before dispatch and excludes prepare_kv", async () => {
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({
        operation_id: "op-load-1",
      });

      const opId = await useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", {
        kind: "load",
        mutation_id: "custom-mut-10",
        expected_sha256: "sha256-hash",
        profile: {
          context_tokens: 4096,
          batch_tokens: 512,
          ubatch_tokens: 128,
          threads: 8,
          gpu_layers: 0,
          kv_placement: "cpu",
          type_k: "f16",
          type_v: "f16",
          flash_attention: true,
        },
        license_accepted: true,
      });

      expect(opId).toBe("op-load-1");
      const mut = useInferenceStore.getState().persistedMutations["custom-mut-10"];
      expect(mut).toBeDefined();
      expect(mut.request).toEqual({
        kind: "load",
        mutation_id: "custom-mut-10",
        expected_sha256: "sha256-hash",
        profile: {
          context_tokens: 4096,
          batch_tokens: 512,
          ubatch_tokens: 128,
          threads: 8,
          gpu_layers: 0,
          kv_placement: "cpu",
          type_k: "f16",
          type_v: "f16",
          flash_attention: true,
        },
        license_accepted: true,
      });
    });

    it("UI-10: does not persist request body for prepare_kv operations", async () => {
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({
        operation_id: "op-prep-1",
      });

      await useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", {
        kind: "prepare_kv",
        mutation_id: "prep-mut-1",
      });

      const mut = useInferenceStore.getState().persistedMutations["prep-mut-1"];
      expect(mut).toBeDefined();
      expect(mut.request).toBeUndefined();
    });

    it("UI-10: marks status as ambiguous on POST failure while preserving mutationId and allowlisted request", async () => {
      mockInferenceService.dispatchModelOperation = vi.fn().mockRejectedValue(new Error("Network drop"));

      await expect(
        useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", {
          kind: "load",
          mutation_id: "lost-mut-1",
          expected_sha256: "sha256-val",
        })
      ).rejects.toThrow("Network drop");

      const mut = useInferenceStore.getState().persistedMutations["lost-mut-1"];
      expect(mut).toBeDefined();
      expect(mut.status).toBe("ambiguous");
      expect(mut.mutationId).toBe("lost-mut-1");
      expect(mut.request?.expected_sha256).toBe("sha256-val");
    });

    it("UI-10: correlates uncommitted/ambiguous mutation via mutation_id on host during reconciliation", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "ambig-mut": {
            mutationId: "ambig-mut",
            hostId: "h1",
            kind: "load",
            status: "ambiguous",
            timestamp: Date.now(),
            request: { kind: "load", mutation_id: "ambig-mut" },
          },
        },
      });

      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([
        {
          operation_id: "op-server-999",
          mutation_id: "ambig-mut",
          state: "running",
          stage: "load_weights",
          revision: 1,
        },
      ]);
      mockInferenceService.getOperation = vi.fn().mockResolvedValue({
        operation_id: "op-server-999",
        state: "running",
        revision: 1,
      });

      await useInferenceStore.getState().reconcilePersistedMutations();

      const mut = useInferenceStore.getState().persistedMutations["ambig-mut"];
      expect(mut).toBeDefined();
      expect(mut.operationId).toBe("op-server-999");
      expect(mut.status).toBe("running");
    });

    it("UI-10: marks lost mutation as unknown when host has no matching operation", async () => {
      useInferenceStore.setState({
        persistedMutations: {
          "no-match-mut": {
            mutationId: "no-match-mut",
            hostId: "h1",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
            request: { kind: "load", mutation_id: "no-match-mut" },
          },
        },
      });

      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([]);

      await useInferenceStore.getState().reconcilePersistedMutations();

      const mut = useInferenceStore.getState().persistedMutations["no-match-mut"];
      expect(mut).toBeDefined();
      expect(mut.status).toBe("unknown");
      expect(mut.mutationId).toBe("no-match-mut");
    });
    it("W1: setServiceAccessContext with deploymentId automatically invalidates store without manual invalidateAccess", async () => {
      setServiceAccessContext({ deploymentId: "http://daemon-auto-a:18790", identityKey: "u1" });
      useInferenceStore.getState().setActiveInstallationId("inst-a");
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({ operation_id: "op-a" });
      await useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", { kind: "load", mutation_id: "mut-a" });

      // Automatically invalidate by setting new deploymentId in context
      setServiceAccessContext({ deploymentId: "http://daemon-auto-b:18790", identityKey: "u1" });

      // Store must automatically re-scope without calling invalidateAccess manually
      expect(useInferenceStore.getState().activeInstallationId).toBeNull();
      expect(useInferenceStore.getState().persistedMutations).toEqual({});
    });

    it("W2: deep sanitization strips extra and private properties on profile and source_ref", async () => {
      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({ operation_id: "op-san-1" });
      const profileWithExtras = {
        context_tokens: 4096,
        batch_tokens: 512,
        ubatch_tokens: 128,
        threads: 8,
        gpu_layers: 0,
        kv_placement: "cpu",
        type_k: "f16",
        type_v: "f16",
        flash_attention: true,
        extra_private_prompt: "secret text",
        internal_token: "sk-private",
      } as unknown as WorkerLoadProfile;

      const sourceRefWithExtras = {
        tenant_id: "t1",
        user_id: "u1",
        workspace_id: "w1",
        session_id: "s1",
        scope_hash: "scope-1",
        session_hash: "sess-1",
        prompt_profile_id: "p1",
        source_revision: "rev-1",
        prefix_digest: "pfx-1",
        preparation_fingerprint: "prep-1",
        raw_prompt_history: ["prompt 1"],
      } as unknown as AppSourceRef;
      await useInferenceStore.getState().dispatchModelOperation("h1", "gemma-4", {
        kind: "load",
        mutation_id: "deep-san-1",
        profile: profileWithExtras,
        source_ref: sourceRefWithExtras,
      });

      const mut = useInferenceStore.getState().persistedMutations["deep-san-1"];
      expect(mut).toBeDefined();
      expect(mut.request?.profile).toBeDefined();
      const rawProfile = mut.request?.profile as unknown as Record<string, unknown>;
      expect(rawProfile.extra_private_prompt).toBeUndefined();
      expect(rawProfile.internal_token).toBeUndefined();
      expect(mut.request?.source_ref).toBeDefined();
      const rawSourceRef = mut.request?.source_ref as unknown as Record<string, unknown>;
      expect(rawSourceRef.raw_prompt_history).toBeUndefined();
    });

    it("W3: projects terminal matching operation into canonical operations before removing mutation", async () => {
      useInferenceStore.setState({
        operations: {},
        hostOperations: {},
        persistedMutations: {
          "mut-term-proj": {
            mutationId: "mut-term-proj",
            hostId: "h1",
            kind: "load",
            status: "pending_dispatch",
            timestamp: Date.now(),
          },
        },
      });

      mockInferenceService.listHostOperations = vi.fn().mockResolvedValue([
        {
          operation_id: "op-term-123",
          mutation_id: "mut-term-proj",
          artifact_id: "gemma-4",
          host_id: "h1",
          state: "completed",
          stage: "load_context",
          revision: 5,
        },
      ]);

      await useInferenceStore.getState().reconcilePersistedMutations();

      // Mutation is pruned from persistedMutations
      expect(useInferenceStore.getState().persistedMutations["mut-term-proj"]).toBeUndefined();
      // Terminal operation is projected into operations and hostOperations
      const canonicalOp = useInferenceStore.getState().operations["op-term-123"];
      expect(canonicalOp).toBeDefined();
      expect(canonicalOp.status).toBe("completed");
      expect(canonicalOp.revision).toBe(5);
      const hostOp = useInferenceStore.getState().hostOperations["h1"]?.find((o) => o.operation_id === "op-term-123");
      expect(hostOp).toBeDefined();
      expect(hostOp?.state).toBe("completed");
    });

    it("W3: retryPendingMutation resubmits with exact same mutationId and allowlisted request", async () => {
      const mutId = "retry-mut-777";
      useInferenceStore.setState({
        persistedMutations: {
          [mutId]: {
            mutationId: mutId,
            hostId: "h1",
            kind: "load",
            artifactId: "gemma-4",
            status: "ambiguous",
            timestamp: Date.now(),
            request: {
              kind: "load",
              mutation_id: mutId,
              artifact_id: "gemma-4",
              expected_sha256: "sha-retry",
            },
          },
        },
      });

      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({ operation_id: "op-retried" });

      const opId = await useInferenceStore.getState().retryPendingMutation(mutId);
      expect(opId).toBe("op-retried");

      expect(mockInferenceService.dispatchModelOperation).toHaveBeenCalledWith(
        "h1",
        "gemma-4",
        expect.objectContaining({ mutation_id: mutId, expected_sha256: "sha-retry" })
      );
    });

    it("W4: mixed expired and terminal entries are pruned at insertion so live map never exceeds 50", async () => {
      const store = useInferenceStore.getState();
      const now = Date.now();
      const TTL_MS = 24 * 60 * 60 * 1000;
      const initialMutations: Record<string, PersistedMutation> = {};
      // 40 active
      for (let i = 1; i <= 40; i++) {
        initialMutations[`active-${i}`] = {
          mutationId: `active-${i}`,
          hostId: "h1",
          kind: "load",
          status: "pending_dispatch",
          timestamp: now - 1000,
        };
      }
      // 15 expired (> 24h)
      for (let i = 1; i <= 15; i++) {
        initialMutations[`expired-${i}`] = {
          mutationId: `expired-${i}`,
          hostId: "h1",
          kind: "load",
          status: "pending_dispatch",
          timestamp: now - TTL_MS - 5000,
        };
      }
      // 5 terminal
      for (let i = 1; i <= 5; i++) {
        initialMutations[`terminal-${i}`] = {
          mutationId: `terminal-${i}`,
          hostId: "h1",
          kind: "load",
          status: "completed",
          timestamp: now - 1000,
        };
      }

      useInferenceStore.setState({ persistedMutations: initialMutations });
      expect(Object.keys(useInferenceStore.getState().persistedMutations).length).toBe(60);

      mockInferenceService.dispatchModelOperation = vi.fn().mockResolvedValue({ operation_id: "op-fresh" });

      await store.dispatchModelOperation("h1", "gemma-4", { kind: "load", mutation_id: "fresh-41" });

      const live = useInferenceStore.getState().persistedMutations;
      expect(Object.keys(live).length).toBe(41);
      expect(live["fresh-41"]).toBeDefined();
      expect(live["expired-1"]).toBeUndefined();
      expect(live["terminal-1"]).toBeUndefined();
    });
  });
});
