import { create } from "zustand";
import type {
  ApproveRecoveryRequest,
  CanonicalOperationSnapshot,
  ClientUpdateRecoveryPreferences,
  ConfiguredStorageRoot,
  CreateInstallationRequest,
  ExecutionTarget,
  HostCacheStatus,
  HostModelRecommendation,
  HostOperationRequest,
  HostRecoveryPreferences,
  HostView,
  InferenceBindingUpdatedPayload,
  InferenceHostUpdatedPayload,
  InferenceOperationProgressEvent,
  InferenceOperationUpdatedPayload,
  InferencePoolUpdatedPayload,
  InferenceRecoveryUpdatedPayload,
  InstallationDescriptor,
  InstallationStatus,
  LocalCompanionStatus,
  ModelInventoryItem,
  OperationSnapshot,
  OperatorRecoveryView,
  PoolBinding,
  PoolBindingMutation,
  PoolBindingState,
  PoolSummary,
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

  // --- Phase 12 Normalized State ---
  hosts: Record<string, HostView>;
  pools: Record<string, PoolSummary>;
  hostModels: Record<string, HostModelRecommendation[]>;
  hostPreferences: Record<string, HostRecoveryPreferences>;
  hostCaches: Record<string, HostCacheStatus[]>;
  hostOperations: Record<string, OperationSnapshot[]>;
  credentialRecoveries: Record<string, OperatorRecoveryView>;
  installations: Record<string, InstallationStatus>;
  activeInstallationId: string | null;
  persistedMutations: Record<string, PersistedMutation>;

  loadingHosts: boolean;
  hostsError: string | null;
  loadingPools: boolean;
  poolsError: string | null;
  loadingRecoveries: boolean;
  recoveriesError: string | null;

  accessKey: string;

  fetchHosts: () => Promise<void>;
  fetchPools: () => Promise<void>;
  fetchHostModels: (hostId: string) => Promise<HostModelRecommendation[]>;
  fetchHostPreferences: (hostId: string) => Promise<void>;
  fetchHostCaches: (hostId: string) => Promise<void>;
  fetchHostOperations: (hostId: string) => Promise<void>;
  fetchCredentialRecoveries: () => Promise<void>;
  createInstallation: (req: CreateInstallationRequest) => Promise<InstallationDescriptor>;
  fetchInstallation: (installationId: string) => Promise<InstallationStatus | null>;
  setActiveInstallationId: (id: string | null) => void;
  mutateBinding: (hostId: string, poolId: string, expectedRevision?: number) => Promise<PoolBinding>;
  unbindHost: (hostId: string, expectedRevision?: number) => Promise<void>;
  saveRecoveryPreferences: (hostId: string, prefs: ClientUpdateRecoveryPreferences) => Promise<HostRecoveryPreferences>;
  dispatchModelOperation: (hostId: string, artifactId: string, req: HostOperationRequest) => Promise<string>;
  cancelOperation: (operationId: string) => Promise<void>;
  pollActiveOperation: (operationId: string) => Promise<void>;
  purgeHostCache: (hostId: string, payload?: { session_id?: string; mutation_id?: string }) => Promise<void>;
  approveCredentialRecovery: (requestId: string, body?: ApproveRecoveryRequest) => Promise<void>;
  denyCredentialRecovery: (requestId: string, expectedRevision?: number) => Promise<void>;

  applyHostUpdatedEvent: (payload: InferenceHostUpdatedPayload) => void;
  applyBindingUpdatedEvent: (payload: InferenceBindingUpdatedPayload) => void;
  applyPoolUpdatedEvent: (payload: InferencePoolUpdatedPayload) => void;
  applyRecoveryUpdatedEvent: (payload: InferenceRecoveryUpdatedPayload) => void;
  applyOperationEvent: (event: InferenceOperationUpdatedPayload, contextKey?: string) => void;
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
  applyRunProgressEvent: (event: RunInferenceProgressEvent, contextKey?: string) => void;
  clearRunProgress: (sessionId: string, runId?: string) => void;

  invalidateAccess: () => void;
  getTargetReadiness: (target?: ExecutionTarget) => TargetReadiness;
  reconcilePersistedMutations: () => Promise<void>;
}

function computeAccessKey(): string {
  const ctx = getServiceAccessContext();
  return `${ctx.identityKey ?? ""}:${ctx.authToken ?? ""}:${ctx.accessRevision ?? 0}`;
}

export interface PersistedMutation {
  mutationId: string;
  hostId: string;
  kind: string;
  artifactId?: string;
  operationId?: string;
  status?: string;
  timestamp: number;
}

function computePersistenceNamespace(): string {
  const ctx = getServiceAccessContext();
  if (ctx.identityKey) {
    return `id:${ctx.identityKey}`;
  }
  return `rev:${ctx.accessRevision ?? 0}`;
}

function mergeHostPreferences(
  existing: HostRecoveryPreferences | undefined,
  incoming: HostRecoveryPreferences
): HostRecoveryPreferences {
  if (!existing) return incoming;

  const keepDesired =
    typeof existing.expected_revision === "number" &&
    typeof incoming.expected_revision === "number" &&
    existing.expected_revision > incoming.expected_revision;

  const keepReconciled =
    typeof existing.reconciled_revision === "number" &&
    typeof incoming.reconciled_revision === "number" &&
    existing.reconciled_revision > incoming.reconciled_revision;

  return {
    host_id: incoming.host_id,
    expected_revision: keepDesired ? existing.expected_revision : incoming.expected_revision,
    reconciled_revision: keepReconciled ? existing.reconciled_revision : incoming.reconciled_revision,
    auto_load_model: keepDesired ? existing.auto_load_model : incoming.auto_load_model,
    auto_prepare_kv: keepDesired ? existing.auto_prepare_kv : incoming.auto_prepare_kv,
    last_selected_model: keepDesired ? existing.last_selected_model : incoming.last_selected_model,
    auto_prepare_source: keepDesired ? existing.auto_prepare_source : incoming.auto_prepare_source,
  };
}

function operationSnapshotToCanonical(op: OperationSnapshot): CanonicalOperationSnapshot {
  let status: CanonicalOperationSnapshot["status"] = "active";
  if (op.state === "completed" || op.state === "failed" || op.state === "cancelled") {
    status = op.state;
  } else if (op.state === "queued") {
    status = "pending";
  }
  const stage = (op.stage as CanonicalOperationSnapshot["stage"]) || "load_weights";
  return {
    operation_id: op.operation_id,
    artifact_id: op.artifact_id,
    execution_target_kind: "server",
    stage,
    status,
    revision: op.revision,
    started_at_ms: op.started_at_ms || op.created_at_ms || Date.now(),
    updated_at_ms: op.updated_at_ms || Date.now(),
    completed_at_ms: op.completed_at_ms,
    error_code: op.error_code,
    error_message: op.error_message,
    counters: op.counters || {},
  };
}

const MAX_PERSISTED_MUTATIONS = 50;
const MUTATION_STORAGE_KEY_PREFIX = "eigen-air:persisted-mutations:ns:";

function cleanupLegacyMutationStorageKeys() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith("eigen-air:persisted-mutations:") && !k.startsWith(MUTATION_STORAGE_KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.sessionStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

function loadPersistedMutations(): Record<string, PersistedMutation> {
  if (typeof window === "undefined" || !window.sessionStorage) return {};
  cleanupLegacyMutationStorageKeys();
  try {
    const ns = computePersistenceNamespace();
    const raw = window.sessionStorage.getItem(`${MUTATION_STORAGE_KEY_PREFIX}${ns}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const valid: Record<string, PersistedMutation> = {};
    const entries = Object.entries(parsed).slice(-MAX_PERSISTED_MUTATIONS);
    const now = Date.now();
    const TTL_MS = 24 * 60 * 60 * 1000;
    for (const [k, v] of entries) {
      if (v && typeof v === "object" && "mutationId" in v && "hostId" in v && "kind" in v) {
        const item = v as PersistedMutation;
        if (typeof item.timestamp === "number" && now - item.timestamp < TTL_MS) {
          valid[k] = item;
        }
      }
    }
    return valid;
  } catch {
    return {};
  }
}

function savePersistedMutations(mutations: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  cleanupLegacyMutationStorageKeys();
  try {
    const ns = computePersistenceNamespace();
    const entries = Object.entries(mutations).slice(-MAX_PERSISTED_MUTATIONS);
    const map = Object.fromEntries(entries);
    window.sessionStorage.setItem(`${MUTATION_STORAGE_KEY_PREFIX}${ns}`, JSON.stringify(map));
  } catch {
    // ignore quota error
  }
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

    hosts: {},
    pools: {},
    hostModels: {},
    hostPreferences: {},
    hostCaches: {},
    hostOperations: {},
    credentialRecoveries: {},
    installations: {},
    activeInstallationId: typeof window !== "undefined" ? window.sessionStorage?.getItem("eigen-air:active-installation-id") ?? null : null,
    persistedMutations: loadPersistedMutations(),

    loadingHosts: false,
    hostsError: null,
    loadingPools: false,
    poolsError: null,
    loadingRecoveries: false,
    recoveriesError: null,

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
        hosts: {},
        pools: {},
        hostModels: {},
        hostPreferences: {},
        hostCaches: {},
        hostOperations: {},
        credentialRecoveries: {},
        installations: {},
        activeInstallationId: null,
        persistedMutations: loadPersistedMutations(),
        loadingHosts: false,
        hostsError: null,
        loadingPools: false,
        poolsError: null,
        loadingRecoveries: false,
        recoveriesError: null,
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
        get().fetchHosts(),
        get().fetchPools(),
        get().fetchCredentialRecoveries(),
      ]);
      void get().reconcilePersistedMutations();
    },

    // --- Phase 12 Gateway Actions ---

    fetchHosts: async () => {
      const startKey = get().accessKey;
      set({ loadingHosts: true, hostsError: null });
      try {
        const list = await getInferenceService().listHosts();
        if (get().accessKey !== startKey) return;
        const map: Record<string, HostView> = { ...get().hosts };
        for (const h of list) {
          const existing = map[h.host_id];
          if (!existing) {
            map[h.host_id] = h;
          } else {
            const keepLifecycle = existing.lifecycle_revision > h.lifecycle_revision;
            const keepBinding = existing.applied_binding_revision > h.applied_binding_revision;
            const keepRecovery =
              existing.recovery &&
              h.recovery &&
              existing.recovery.reconciled_revision > h.recovery.reconciled_revision;
            map[h.host_id] = {
              ...h,
              is_connected: keepLifecycle ? existing.is_connected : h.is_connected,
              lease_valid: keepLifecycle ? existing.lease_valid : h.lease_valid,
              current_binding: keepBinding ? existing.current_binding : h.current_binding,
              applied_binding_revision: keepBinding
                ? existing.applied_binding_revision
                : h.applied_binding_revision,
              recovery: keepRecovery ? existing.recovery : h.recovery,
              lifecycle_revision: Math.max(existing.lifecycle_revision, h.lifecycle_revision),
            };
          }
        }
        set({ hosts: map, loadingHosts: false });
      } catch (e: unknown) {
        if (get().accessKey !== startKey) return;
        const msg = e instanceof Error ? e.message : "Failed to fetch hosts";
        set({ hostsError: msg, loadingHosts: false });
      }
    },

    fetchPools: async () => {
      const startKey = get().accessKey;
      set({ loadingPools: true, poolsError: null });
      try {
        const list = await getInferenceService().listPools();
        if (get().accessKey !== startKey) return;
        const map: Record<string, PoolSummary> = {};
        for (const p of list) {
          map[p.pool_id] = p;
        }
        set({ pools: map, loadingPools: false });
      } catch (e: unknown) {
        if (get().accessKey !== startKey) return;
        const msg = e instanceof Error ? e.message : "Failed to fetch pools";
        set({ poolsError: msg, loadingPools: false });
      }
    },

    fetchHostModels: async (hostId: string): Promise<HostModelRecommendation[]> => {
      const startKey = get().accessKey;
      try {
        const recs = await getInferenceService().listHostModels(hostId);
        if (get().accessKey !== startKey) return [];
        set((state) => ({
          hostModels: {
            ...state.hostModels,
            [hostId]: recs,
          },
        }));
        return recs;
      } catch {
        return [];
      }
    },

    fetchHostPreferences: async (hostId: string) => {
      const startKey = get().accessKey;
      try {
        const prefs = await getInferenceService().getRecoveryPreferences(hostId);
        if (get().accessKey !== startKey) return;
        set((state) => ({
          hostPreferences: {
            ...state.hostPreferences,
            [hostId]: mergeHostPreferences(state.hostPreferences[hostId], prefs),
          },
        }));
      } catch {
        // ignore background fetch failure
      }
    },

    fetchHostCaches: async (hostId: string) => {
      const startKey = get().accessKey;
      try {
        const caches = await getInferenceService().getHostCacheStatus(hostId);
        if (get().accessKey !== startKey) return;
        set((state) => ({
          hostCaches: {
            ...state.hostCaches,
            [hostId]: caches,
          },
        }));
      } catch {
        // ignore background fetch failure
      }
    },

    fetchHostOperations: async (hostId: string) => {
      const startKey = get().accessKey;
      try {
        const ops = await getInferenceService().listHostOperations(hostId);
        if (get().accessKey !== startKey) return;
        const currentOps = { ...get().operations };
        for (const op of ops) {
          const existing = currentOps[op.operation_id];
          if (!existing || op.revision >= existing.revision) {
            currentOps[op.operation_id] = op as unknown as CanonicalOperationSnapshot;
          }
        }
        set((state) => ({
          operations: currentOps,
          hostOperations: {
            ...state.hostOperations,
            [hostId]: ops,
          },
        }));
      } catch {
        // ignore background fetch failure
      }
    },

    pollActiveOperation: async (operationId: string) => {
      const startKey = get().accessKey;
      try {
        const op = await getInferenceService().getOperation(operationId);
        if (get().accessKey !== startKey) return;
        const existing = get().operations[op.operation_id];
        if (!existing || op.revision >= existing.revision) {
          set((state) => {
            const nextOps = {
              ...state.operations,
              [op.operation_id]: operationSnapshotToCanonical(op),
            };
            const isTerminal =
              op.state === "completed" || op.state === "failed" || op.state === "cancelled";
            if (isTerminal) {
              let changed = false;
              const nextMutations = { ...state.persistedMutations };
              for (const [k, m] of Object.entries(nextMutations)) {
                if (m.operationId === op.operation_id) {
                  delete nextMutations[k];
                  changed = true;
                }
              }
              if (changed) {
                savePersistedMutations(nextMutations);
                return { operations: nextOps, persistedMutations: nextMutations };
              }
            }
            return { operations: nextOps };
          });
        }
      } catch {
        // ignore targeted poll failure
      }
    },

    fetchCredentialRecoveries: async () => {
      const startKey = get().accessKey;
      set({ loadingRecoveries: true, recoveriesError: null });
      try {
        const list = await getInferenceService().listCredentialRecoveries();
        if (get().accessKey !== startKey) return;
        const currentRecoveries = get().credentialRecoveries;
        const map: Record<string, OperatorRecoveryView> = {};
        for (const r of list) {
          const existing = currentRecoveries[r.request_id];
          if (existing) {
            if (existing.requested_credential_generation > r.requested_credential_generation) {
              map[r.request_id] = existing;
              continue;
            }
            if (
              existing.requested_credential_generation === r.requested_credential_generation &&
              existing.approval_revision > r.approval_revision
            ) {
              map[r.request_id] = existing;
              continue;
            }
          }
          map[r.request_id] = r;
        }
        set({ credentialRecoveries: map, loadingRecoveries: false });
      } catch (e: unknown) {
        if (get().accessKey !== startKey) return;
        const msg = e instanceof Error ? e.message : "Failed to fetch recoveries";
        set({ recoveriesError: msg, loadingRecoveries: false });
      }
    },

    createInstallation: async (req: CreateInstallationRequest) => {
      const startKey = get().accessKey;
      const desc = await getInferenceService().createInstallation(req);
      if (get().accessKey !== startKey) return desc;
      get().setActiveInstallationId(desc.installation_id);
      return desc;
    },

    fetchInstallation: async (installationId: string) => {
      const startKey = get().accessKey;
      try {
        const status = await getInferenceService().getInstallation(installationId);
        if (get().accessKey !== startKey) return null;
        set((state) => ({
          installations: {
            ...state.installations,
            [installationId]: status,
          },
        }));
        return status;
      } catch {
        return null;
      }
    },

    setActiveInstallationId: (id: string | null) => {
      if (typeof window !== "undefined" && window.sessionStorage) {
        if (id) {
          window.sessionStorage.setItem("eigen-air:active-installation-id", id);
        } else {
          window.sessionStorage.removeItem("eigen-air:active-installation-id");
        }
      }
      set({ activeInstallationId: id });
    },

    mutateBinding: async (hostId: string, poolId: string, expectedRevision?: number) => {
      const mutationId = `${Date.now()}-${crypto.randomUUID()}`;
      const binding = await getInferenceService().mutateBinding(hostId, {
        pool_id: poolId,
        expected_revision: expectedRevision,
        mutation_id: mutationId,
      });
      // Refresh host and pool state
      await Promise.allSettled([get().fetchHosts(), get().fetchPools()]);
      return binding;
    },

    unbindHost: async (hostId: string, expectedRevision?: number) => {
      await getInferenceService().unbindHost(hostId, expectedRevision);
      await Promise.allSettled([get().fetchHosts(), get().fetchPools()]);
    },

    saveRecoveryPreferences: async (hostId: string, prefs: ClientUpdateRecoveryPreferences) => {
      const startKey = get().accessKey;
      const saved = await getInferenceService().saveRecoveryPreferences(hostId, prefs);
      if (get().accessKey !== startKey) return saved;
      set((state) => ({
        hostPreferences: {
          ...state.hostPreferences,
          [hostId]: mergeHostPreferences(state.hostPreferences[hostId], saved),
        },
      }));
      await get().fetchHosts();
      return saved;
    },

    dispatchModelOperation: async (
      hostId: string,
      artifactId: string,
      req: HostOperationRequest
    ) => {
      const startKey = get().accessKey;
      const mutationId = req.mutation_id || `${Date.now()}-${crypto.randomUUID()}`;
      const persisted = {
        mutationId,
        hostId,
        kind: req.kind,
        artifactId,
        timestamp: Date.now(),
      };
      set((state) => {
        const nextMutations = {
          ...state.persistedMutations,
          [mutationId]: persisted,
        };
        savePersistedMutations(nextMutations);
        return { persistedMutations: nextMutations };
      });

      const opReq: HostOperationRequest = {
        ...req,
        mutation_id: mutationId,
      };
      const res = await getInferenceService().dispatchModelOperation(hostId, artifactId, opReq);
      if (get().accessKey !== startKey) {
        return res.operation_id;
      }
      if (res.operation_id) {
        set((state) => {
          const updated = {
            ...state.persistedMutations,
            [mutationId]: {
              ...persisted,
              operationId: res.operation_id,
              status: "dispatched",
            },
          };
          savePersistedMutations(updated);
          return { persistedMutations: updated };
        });
        void get().pollActiveOperation(res.operation_id);
      }
      await Promise.allSettled([
        get().fetchHostOperations(hostId),
        get().fetchHostModels(hostId),
      ]);
      return res.operation_id;
    },

    cancelOperation: async (operationId: string) => {
      await getInferenceService().cancelOperation(operationId);
      await get().fetchHosts();
    },

    purgeHostCache: async (
      hostId: string,
      payload?: { session_id?: string; mutation_id?: string }
    ) => {
      const sessionId = payload?.session_id?.trim();
      if (!sessionId) {
        throw new Error("Explicit session_id is required for host cache purge");
      }
      await getInferenceService().purgeHostCache(hostId, {
        session_id: sessionId,
        mutation_id: payload?.mutation_id,
      });
      await Promise.allSettled([
        get().fetchHostCaches(hostId),
        get().fetchHostModels(hostId),
      ]);
    },

    approveCredentialRecovery: async (
      requestId: string,
      body: ApproveRecoveryRequest = {}
    ) => {
      const startKey = get().accessKey;
      const updated = await getInferenceService().approveCredentialRecovery(requestId, body);
      if (get().accessKey !== startKey) return;
      set((state) => ({
        credentialRecoveries: {
          ...state.credentialRecoveries,
          [requestId]: updated,
        },
      }));
      await get().fetchCredentialRecoveries();
    },

    denyCredentialRecovery: async (requestId: string, expectedRevision?: number) => {
      const startKey = get().accessKey;
      const updated = await getInferenceService().denyCredentialRecovery(requestId, expectedRevision);
      if (get().accessKey !== startKey) return;
      set((state) => ({
        credentialRecoveries: {
          ...state.credentialRecoveries,
          [requestId]: updated,
        },
      }));
      await get().fetchCredentialRecoveries();
    },

    applyHostUpdatedEvent: (payload: InferenceHostUpdatedPayload) => {
      set((state) => {
        const existing = state.hosts[payload.host_id];
        if (!existing) return state;
        if (typeof payload.revision === "number" && existing.lifecycle_revision > payload.revision) {
          return state;
        }
        return {
          hosts: {
            ...state.hosts,
            [payload.host_id]: {
              ...existing,
              is_connected: typeof payload.is_connected === "boolean" ? payload.is_connected : existing.is_connected,
              lease_valid: typeof payload.lease_valid === "boolean" ? payload.lease_valid : existing.lease_valid,
              recovery: payload.recovery ?? existing.recovery,
              lifecycle_revision: typeof payload.revision === "number" ? payload.revision : existing.lifecycle_revision,
            },
          },
        };
      });
    },

    applyBindingUpdatedEvent: (payload: InferenceBindingUpdatedPayload) => {
      set((state) => {
        const existing = state.hosts[payload.host_id];
        if (!existing) return state;
        if (existing.applied_binding_revision > payload.revision) {
          return state;
        }
        const nextState: PoolBindingState =
          payload.state === "unbound" || payload.state === "bound" || payload.state === "draining"
            ? payload.state
            : "bound";
        return {
          hosts: {
            ...state.hosts,
            [payload.host_id]: {
              ...existing,
              applied_binding_revision: payload.revision,
              current_binding: {
                host_id: payload.host_id,
                pool_id: payload.pool_id,
                revision: payload.revision,
                state: nextState,
                changed_at_ms: Date.now(),
              },
            },
          },
        };
      });
      get().fetchPools();
    },

    applyPoolUpdatedEvent: (payload: InferencePoolUpdatedPayload) => {
      set((state) => {
        const existing = state.pools[payload.pool_id];
        if (!existing) return state;
        return {
          pools: {
            ...state.pools,
            [payload.pool_id]: {
              ...existing,
              ready_hosts: typeof payload.ready_hosts === "number" ? payload.ready_hosts : existing.ready_hosts,
              busy_hosts: typeof payload.busy_hosts === "number" ? payload.busy_hosts : existing.busy_hosts,
              offline_hosts: typeof payload.offline_hosts === "number" ? payload.offline_hosts : existing.offline_hosts,
            },
          },
        };
      });
    },

    applyRecoveryUpdatedEvent: (payload: InferenceRecoveryUpdatedPayload) => {
      set((state) => {
        const existing = state.credentialRecoveries[payload.request_id];
        if (!existing) return state;
        const rawPayload = payload as { revision?: number };
        const incomingRev = payload.approval_revision ?? rawPayload.revision;
        if (typeof incomingRev === "number" && existing.approval_revision > incomingRev) {
          return state;
        }
        return {
          credentialRecoveries: {
            ...state.credentialRecoveries,
            [payload.request_id]: {
              ...existing,
              status: payload.status as OperatorRecoveryView["status"],
              approval_revision: typeof incomingRev === "number" ? incomingRev : existing.approval_revision,
            },
          },
        };
      });
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

    applyOperationEvent: (event: InferenceOperationUpdatedPayload, contextKey?: string) => {
      const currentKey = get().accessKey;
      if (contextKey && contextKey !== currentKey) return;

      if (!("stage" in event)) {
        const existing = get().operations[event.operation_id];
        if (existing && typeof event.revision === "number" && existing.revision > event.revision) {
          return;
        }
        if (existing) {
          set((state) => ({
            operations: {
              ...state.operations,
              [event.operation_id]: {
                ...existing,
                status: (event.state as CanonicalOperationSnapshot["status"]) || existing.status,
                revision: typeof event.revision === "number" ? event.revision : existing.revision,
                updated_at_ms: Date.now(),
              },
            },
          }));
        }
        return;
      }

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

      if (target.kind === "pool") {
        const pool = get().pools[target.pool_id];
        const isReady = Boolean(pool && pool.ready_hosts > 0);
        return {
          canInfer: isReady,
          isReady,
          phase: isReady ? "ready" : "offline",
          label: pool ? `Pool: ${pool.pool_id}` : `Pool ${target.pool_id}`,
          reason: isReady ? undefined : "No ready hosts in pool",
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

    reconcilePersistedMutations: async () => {
      const startKey = get().accessKey;
      const mutations = get().persistedMutations;
      const now = Date.now();
      const updated = { ...mutations };
      let changed = false;

      for (const [id, m] of Object.entries(mutations)) {
        if (now - m.timestamp > 24 * 60 * 60 * 1000) {
          delete updated[id];
          changed = true;
          continue;
        }
        if (m.status === "completed" || m.status === "failed" || m.status === "cancelled") {
          delete updated[id];
          changed = true;
          continue;
        }
        if (m.operationId) {
          void get().pollActiveOperation(m.operationId);
        } else {
          try {
            const ops = await getInferenceService().listHostOperations(m.hostId);
            if (get().accessKey !== startKey) return;
            const matched = ops.find((op) => op.operation_id === m.mutationId);
            if (matched) {
              if (
                matched.state === "completed" ||
                matched.state === "failed" ||
                matched.state === "cancelled"
              ) {
                delete updated[id];
              } else {
                updated[id] = {
                  ...m,
                  operationId: matched.operation_id,
                  status: matched.state,
                };
                void get().pollActiveOperation(matched.operation_id);
              }
              changed = true;
            }
          } catch {
            // retain within TTL
          }
        }
      }

      if (changed && get().accessKey === startKey) {
        set((state) => {
          const merged = { ...state.persistedMutations };
          for (const [id, m] of Object.entries(updated)) {
            if (merged[id]) {
              merged[id] = { ...merged[id], ...m };
            }
          }
          for (const id of Object.keys(mutations)) {
            if (!updated[id] && merged[id]) {
              delete merged[id];
            }
          }
          savePersistedMutations(merged);
          return { persistedMutations: merged };
        });
      }
    },
  };
});
