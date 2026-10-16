import { create } from "zustand";
import type {
  CanonicalOperationSnapshot,
  ConfiguredStorageRoot,
  ExecutionTarget,
  InferenceOperationProgressEvent,
  LocalCompanionStatus,
  ModelInventoryItem,
  PublicDeviceSummary,
  RunInferenceProgressEvent,
  StorageRootDescriptor,
} from "@eigen-air-ui/shared/types";
import {
  getInferenceService,
  getLocalCompanionService,
  getServiceAccessContext,
  registerAccessInvalidationListener,
} from "../adapters/factory/ServiceFactory.js";
import { useReadinessStore } from "./readinessStore.js";

export interface TargetReadiness {
  canInfer: boolean;
  isReady: boolean;
  phase: "ready" | "loading" | "failed" | "offline";
  label: string;
  reason?: string;
}

export interface InferenceStoreState {
  serverModels: ModelInventoryItem[];
  serverRoots: StorageRootDescriptor[];
  selectedServerRootId: string | null;
  loadingServerModels: boolean;
  serverModelsError: string | null;

  devices: PublicDeviceSummary[];
  loadingDevices: boolean;
  devicesError: string | null;

  companionStatus: LocalCompanionStatus | null;
  companionRoots: ConfiguredStorageRoot[];
  loadingCompanion: boolean;
  companionError: string | null;

  operations: Record<string, CanonicalOperationSnapshot>;
  runProgress: Record<string, RunInferenceProgressEvent>;

  accessKey: string;

  fetchServerModels: () => Promise<void>;
  fetchServerRoots: () => Promise<void>;
  fetchDevices: () => Promise<void>;
  fetchCompanionStatus: () => Promise<void>;
  fetchAll: () => Promise<void>;

  selectServerRoot: (rootId: string) => Promise<void>;
  downloadServerModel: (artifactId: string) => Promise<CanonicalOperationSnapshot>;
  deleteServerModel: (artifactId: string) => Promise<void>;
  loadServerModel: (artifactId: string) => Promise<void>;
  unloadServerModel: (artifactId: string) => Promise<void>;
  prepareServerModelCache: (artifactId: string, prompt?: string) => Promise<CanonicalOperationSnapshot>;
  purgeServerModelCache: (artifactId: string) => Promise<void>;

  cancelServerOperation: (operationId: string) => Promise<void>;

  revokeDevice: (deviceId: string) => Promise<void>;
  retireDevice: (deviceId: string, archiveWarning?: boolean) => Promise<void>;

  startCompanion: () => Promise<void>;
  stopCompanion: (keepRunning?: boolean) => Promise<void>;
  pickCompanionStorageFolder: () => Promise<{ path: string; cancelled?: boolean }>;
  downloadDeviceModel: (artifactId: string, licenseAccepted: boolean) => Promise<string>;
  unpairDeviceCompanion: (deviceId?: string, deleteCaches?: boolean) => Promise<{ cleanup_state: string; credentials_wiped: boolean } | null>;

  applyOperationSnapshot: (snapshot: CanonicalOperationSnapshot, contextKey?: string) => void;
  applyOperationEvent: (event: InferenceOperationProgressEvent, contextKey?: string) => void;
  applyRunProgressEvent: (event: RunInferenceProgressEvent, contextKey?: string) => void;
  clearRunProgress: (sessionId: string, runId?: string) => void;

  invalidateAccess: () => void;
  getTargetReadiness: (target?: ExecutionTarget) => TargetReadiness;
}

function computeAccessKey(): string {
  const ctx = getServiceAccessContext();
  return `${ctx.identityKey ?? ""}:${ctx.authToken ?? ""}:${ctx.accessRevision ?? 0}`;
}

export const useInferenceStore = create<InferenceStoreState>((set, get) => {
  registerAccessInvalidationListener(() => {
    get().invalidateAccess();
  });

  return {
    serverModels: [],
    serverRoots: [],
    selectedServerRootId: null,
    loadingServerModels: false,
    serverModelsError: null,

    devices: [],
    loadingDevices: false,
    devicesError: null,

    companionStatus: null,
    companionRoots: [],
    loadingCompanion: false,
    companionError: null,

    operations: {},
    runProgress: {},

    accessKey: computeAccessKey(),

    invalidateAccess: () => {
      set({
        serverModels: [],
        serverRoots: [],
        selectedServerRootId: null,
        loadingServerModels: false,
        serverModelsError: null,
        devices: [],
        loadingDevices: false,
        devicesError: null,
        companionStatus: null,
        companionRoots: [],
        loadingCompanion: false,
        companionError: null,
        operations: {},
        runProgress: {},
        accessKey: computeAccessKey(),
      });
    },

    fetchServerModels: async () => {
      const startKey = get().accessKey;
      set({ loadingServerModels: true, serverModelsError: null });
      try {
        const models = await getInferenceService().listServerModels();
        if (get().accessKey !== startKey) return;
        set({ serverModels: models, loadingServerModels: false });
      } catch (e) {
        if (get().accessKey !== startKey) return;
        set({
          serverModelsError: e instanceof Error ? e.message : "Failed to load server models",
          loadingServerModels: false,
        });
      }
    },

    fetchServerRoots: async () => {
      const startKey = get().accessKey;
      try {
        const roots = await getInferenceService().listServerRoots();
        if (get().accessKey !== startKey) return;
        set({ serverRoots: roots });
      } catch {
        // Silently tolerate if caller lacks root list permissions
      }
    },

    fetchDevices: async () => {
      const startKey = get().accessKey;
      set({ loadingDevices: true, devicesError: null });
      try {
        const devices = await getInferenceService().listDevices();
        if (get().accessKey !== startKey) return;
        set({ devices, loadingDevices: false });
      } catch (e) {
        if (get().accessKey !== startKey) return;
        set({
          devicesError: e instanceof Error ? e.message : "Failed to load devices",
          loadingDevices: false,
        });
      }
    },

    fetchCompanionStatus: async () => {
      const local = getLocalCompanionService();
      if (!local || !local.isAvailable()) {
        set({ companionStatus: null, companionRoots: [], loadingCompanion: false });
        return;
      }
      set({ loadingCompanion: true, companionError: null });
      try {
        const status = await local.getStatus();
        let roots: ConfiguredStorageRoot[] = [];
        try {
          const resp = await local.sendCommand({ cmd: "list_roots" });
          if (resp.response === "roots") {
            roots = resp.roots;
          }
        } catch {
          // tolerate if companion is stopped
        }
        set({
          companionStatus: status,
          companionRoots: roots,
          loadingCompanion: false,
        });
      } catch (e) {
        set({
          companionError: e instanceof Error ? e.message : "Failed to query local companion",
          loadingCompanion: false,
        });
      }
    },

    fetchAll: async () => {
      await Promise.allSettled([
        get().fetchServerModels(),
        get().fetchServerRoots(),
        get().fetchDevices(),
        get().fetchCompanionStatus(),
      ]);
    },

    selectServerRoot: async (rootId: string) => {
      const res = await getInferenceService().selectServerRoot(rootId);
      set({ selectedServerRootId: res.selected_root_id });
      await get().fetchServerRoots();
    },

    downloadServerModel: async (artifactId: string) => {
      const snapshot = await getInferenceService().downloadServerModel(artifactId);
      get().applyOperationSnapshot(snapshot);
      await get().fetchServerModels();
      return snapshot;
    },

    deleteServerModel: async (artifactId: string) => {
      await getInferenceService().deleteServerModel(artifactId);
      await get().fetchServerModels();
    },

    loadServerModel: async (artifactId: string) => {
      const snapshot = await getInferenceService().loadServerModel(artifactId);
      get().applyOperationSnapshot(snapshot);
      await get().fetchServerModels();
    },

    unloadServerModel: async (artifactId: string) => {
      const snapshot = await getInferenceService().unloadServerModel(artifactId);
      get().applyOperationSnapshot(snapshot);
      await get().fetchServerModels();
    },
    prepareServerModelCache: async (artifactId: string, prompt?: string) => {
      const snapshot = await getInferenceService().prepareServerModelCache(artifactId, prompt);
      get().applyOperationSnapshot(snapshot);
      return snapshot;
    },

    purgeServerModelCache: async (artifactId: string) => {
      await getInferenceService().purgeServerModelCache(artifactId);
      await get().fetchServerModels();
    },

    cancelServerOperation: async (operationId: string) => {
      const snapshot = await getInferenceService().cancelServerOperation(operationId);
      get().applyOperationSnapshot(snapshot);
    },

    revokeDevice: async (deviceId: string) => {
      await getInferenceService().revokeDevice(deviceId);
      await get().fetchDevices();
    },

    retireDevice: async (deviceId: string, archiveWarning = true) => {
      await getInferenceService().retireDevice(deviceId, { archive_warning: archiveWarning });
      await get().fetchDevices();
    },

    startCompanion: async () => {
      const local = getLocalCompanionService();
      if (!local) throw new Error("Local companion not available");
      await local.start();
      await get().fetchCompanionStatus();
    },

    stopCompanion: async (keepRunning = false) => {
      const local = getLocalCompanionService();
      if (!local) return;
      await local.stop(keepRunning);
      await get().fetchCompanionStatus();
    },

    pickCompanionStorageFolder: async () => {
      const local = getLocalCompanionService();
      if (!local) throw new Error("Local companion not available");
      const res = await local.pickStorageFolder("Select Storage Directory for Models");
      if (!res.cancelled) {
        await get().fetchCompanionStatus();
      }
      return { path: res.path, cancelled: res.cancelled };
    },

    downloadDeviceModel: async (artifactId: string, licenseAccepted: boolean) => {
      const local = getLocalCompanionService();
      if (!local) throw new Error("Local companion not available");
      const resp = await local.sendCommand({
        cmd: "start_download",
        artifact_id: artifactId,
        license_accepted: licenseAccepted,
      });
      if (resp.response === "operation_started") {
        return resp.operation_id;
      }
      if (resp.response === "error") {
        throw new Error(resp.message);
      }
      return `download_${artifactId}`;
    },
    unpairDeviceCompanion: async (deviceId?: string, deleteCaches = true) => {
      const local = getLocalCompanionService();
      if (!local) return null;
      const resp = await local.sendCommand({
        cmd: "unpair",
        delete_caches: deleteCaches,
        device_id: deviceId,
        enrollment_id: deviceId,
      });
      await get().fetchCompanionStatus();
      if (resp.response === "unpaired") {
        return {
          cleanup_state: resp.cleanup_state,
          credentials_wiped: resp.credentials_wiped,
        };
      }
      if (resp.response === "error") {
        throw new Error(resp.message);
      }
      return null;
    },

    applyOperationSnapshot: (snapshot: CanonicalOperationSnapshot, contextKey?: string) => {
      const currentKey = get().accessKey;
      if (contextKey && contextKey !== currentKey) return;

      const existing = get().operations[snapshot.operation_id];
      if (existing && existing.revision > snapshot.revision) {
        return;
      }
      set((state) => ({
        operations: {
          ...state.operations,
          [snapshot.operation_id]: snapshot,
        },
      }));
    },

    applyOperationEvent: (event: InferenceOperationProgressEvent, contextKey?: string) => {
      const currentKey = get().accessKey;
      if (contextKey && contextKey !== currentKey) return;

      const existing = get().operations[event.operation_id];
      if (existing && existing.revision > event.revision) {
        return;
      }

      const snapshot: CanonicalOperationSnapshot = {
        operation_id: event.operation_id,
        artifact_id: event.artifact_id,
        execution_target_kind: event.execution_target_kind,
        stage: event.stage,
        status: event.status,
        revision: event.revision,
        started_at_ms: existing ? existing.started_at_ms : event.occurred_at_ms - event.elapsed_ms,
        updated_at_ms: event.occurred_at_ms,
        completed_at_ms:
          event.status === "completed" || event.status === "failed" || event.status === "cancelled"
            ? event.occurred_at_ms
            : null,
        error_code: existing?.error_code,
        error_message: existing?.error_message,
        counters: event.counters,
      };

      set((state) => ({
        operations: {
          ...state.operations,
          [event.operation_id]: snapshot,
        },
      }));
    },

    applyRunProgressEvent: (event: RunInferenceProgressEvent, contextKey?: string) => {
      const currentKey = get().accessKey;
      if (contextKey && contextKey !== currentKey) return;
      const key = `${event.session_id}:${event.run_id}:${event.turn_index}`;
      const existing = get().runProgress[key];
      if (existing && existing.revision > event.revision) {
        return;
      }
      set((state) => ({
        runProgress: {
          ...state.runProgress,
          [key]: event,
        },
      }));
    },

    clearRunProgress: (sessionId: string, runId?: string) => {
      set((state) => {
        const next = { ...state.runProgress };
        for (const k of Object.keys(next)) {
          if (runId ? k.startsWith(`${sessionId}:${runId}:`) : k.startsWith(`${sessionId}:`)) {
            delete next[k];
          }
        }
        return { runProgress: next };
      });
    },

    getTargetReadiness: (target?: ExecutionTarget): TargetReadiness => {
      if (!target || target.kind === "server") {
        const readiness = useReadinessStore.getState();
        const isReady = readiness.phase === "ready" || readiness.phase === "degraded_cpu";
        return {
          canInfer: readiness.canInfer && isReady,
          isReady,
          phase: isReady ? "ready" : readiness.phase === "failed" ? "failed" : "loading",
          label: "Server",
          reason: readiness.error ?? undefined,
        };
      }

      const device = get().devices.find((d) => d.device_id === target.device_id);
      if (!device) {
        return {
          canInfer: false,
          isReady: false,
          phase: "offline",
          label: `Device ${target.device_id.slice(0, 8)}`,
          reason: "Device not found for current owner",
        };
      }

      if (device.status !== "active") {
        return {
          canInfer: false,
          isReady: false,
          phase: "failed",
          label: device.display_label || `Device ${target.device_id.slice(0, 8)}`,
          reason: `Device is ${device.status}`,
        };
      }

      // Check live connection metadata if available
      const meta = device.runtime_metadata ?? {};
      if (meta.connected === false || meta.online === false) {
        return {
          canInfer: false,
          isReady: false,
          phase: "offline",
          label: device.display_label || `Device ${target.device_id.slice(0, 8)}`,
          reason: "Device is offline",
        };
      }

      // Check model installation if installed_models array is advertised
      if (target.model_artifact_id && Array.isArray(meta.installed_models)) {
        const installed = meta.installed_models.some((m: unknown) => {
          if (m === target.model_artifact_id) return true;
          if (m && typeof m === "object" && "artifact_id" in m) {
            return m.artifact_id === target.model_artifact_id;
          }
          return false;
        });
        if (!installed) {
          return {
            canInfer: false,
            isReady: false,
            phase: "failed",
            label: device.display_label || `Device ${target.device_id.slice(0, 8)}`,
            reason: `Model '${target.model_artifact_id}' not installed on device`,
          };
        }
      }

      return {
        canInfer: true,
        isReady: true,
        phase: "ready",
        label: device.display_label || `Device ${target.device_id.slice(0, 8)}`,
      };
    },
  };
});
