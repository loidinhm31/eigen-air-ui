import { beforeEach, describe, expect, it } from "vitest";
import type {
  CanonicalOperationSnapshot,
  RunInferenceProgressEvent,
} from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "./inferenceStore.js";
import { useReadinessStore } from "./readinessStore.js";

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
  });
});
