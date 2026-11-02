import { create } from "zustand";
import { AUTHORITATIVE_CATALOG_DIGESTS } from "@eigen-air-ui/shared/types";
import type {
  ApproveRecoveryRequest,
  AppSourceRef,
  CanonicalOperationSnapshot,
  ClientUpdateRecoveryPreferences,
  ConfiguredStorageRoot,
  CreateInstallationRequest,
  ExecutionTarget,
  HostCacheStatus,
  HostModelRecommendation,
  HostOperationRequest,
  HostRecoveryPreferences,
  HostRecoveryStatus,
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
  OperationKind,
  OperationSnapshot,
  OperationState,
  OperatorRecoveryView,
  PoolBinding,
  PoolBindingMutation,
  PoolBindingState,
  PoolSummary,
  PublicDeviceSummary,
  RunInferenceProgressEvent,
  StorageRootDescriptor,
  WorkerLoadProfile,
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
  retryPendingMutation: (mutationId: string) => Promise<string | undefined>;
}

function computeAccessKey(): string {
  const ctx = getServiceAccessContext();
  const dep = "deploymentId" in ctx && typeof ctx.deploymentId === "string" ? ctx.deploymentId.trim() : "";
  return `${dep}:${ctx.identityKey ?? ""}:${ctx.authToken ?? ""}:${ctx.accessRevision ?? 0}`;
}

export interface AllowlistedOperationRequest {
  kind: OperationKind;
  artifact_id?: string;
  mutation_id?: string;
  expected_sha256?: string;
  profile?: WorkerLoadProfile;
  license_accepted?: boolean;
  source_root_id?: string;
  source_relative_path?: string;
  target_root_id?: string;
  scope_key?: string;
  session_hash?: string;
  invalidation_revision?: number;
  intent_revision?: number;
  source_ref?: AppSourceRef;
}

export type PersistedMutationStatus =
  | "pending_dispatch"
  | "dispatched"
  | "ambiguous"
  | "unknown"
  | "expired"
  | OperationState;

export interface PersistedMutation {
  mutationId: string;
  hostId: string;
  kind: string;
  artifactId?: string;
  operationId?: string;
  status?: PersistedMutationStatus | string;
  timestamp: number;
  request?: AllowlistedOperationRequest;
}

function sanitizeWorkerLoadProfile(profile: unknown): WorkerLoadProfile | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const p = profile as Record<string, unknown>;
  if (
    typeof p.context_tokens !== "number" ||
    typeof p.batch_tokens !== "number" ||
    typeof p.ubatch_tokens !== "number" ||
    typeof p.threads !== "number" ||
    typeof p.gpu_layers !== "number" ||
    typeof p.kv_placement !== "string" ||
    typeof p.type_k !== "string" ||
    typeof p.type_v !== "string" ||
    typeof p.flash_attention !== "boolean"
  ) {
    return undefined;
  }
  const clean: WorkerLoadProfile = {
    context_tokens: p.context_tokens,
    batch_tokens: p.batch_tokens,
    ubatch_tokens: p.ubatch_tokens,
    threads: p.threads,
    gpu_layers: p.gpu_layers,
    kv_placement: p.kv_placement,
    type_k: p.type_k,
    type_v: p.type_v,
    flash_attention: p.flash_attention,
  };
  if (typeof p.device_index === "number" || p.device_index === null) {
    clean.device_index = p.device_index;
  }
  if (typeof p.swa_full === "boolean") {
    clean.swa_full = p.swa_full;
  }
  if (typeof p.n_rs_seq === "number") {
    clean.n_rs_seq = p.n_rs_seq;
  }
  return clean;
}

function sanitizeAppSourceRef(ref: unknown): AppSourceRef | undefined {
  if (!ref || typeof ref !== "object") return undefined;
  const r = ref as Record<string, unknown>;
  if (
    typeof r.tenant_id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.workspace_id !== "string" ||
    typeof r.session_id !== "string" ||
    typeof r.scope_hash !== "string" ||
    typeof r.session_hash !== "string" ||
    typeof r.prompt_profile_id !== "string" ||
    typeof r.source_revision !== "string" ||
    typeof r.prefix_digest !== "string" ||
    typeof r.preparation_fingerprint !== "string"
  ) {
    return undefined;
  }
  return {
    tenant_id: r.tenant_id,
    user_id: r.user_id,
    workspace_id: r.workspace_id,
    session_id: r.session_id,
    scope_hash: r.scope_hash,
    session_hash: r.session_hash,
    prompt_profile_id: r.prompt_profile_id,
    source_revision: r.source_revision,
    prefix_digest: r.prefix_digest,
    preparation_fingerprint: r.preparation_fingerprint,
  };
}

function sanitizeAllowlistedOperationRequest(
  req: HostOperationRequest
): AllowlistedOperationRequest | undefined {
  if (req.kind === "prepare_kv") {
    return undefined;
  }
  const sanitized: AllowlistedOperationRequest = {
    kind: req.kind,
  };
  if (typeof req.artifact_id === "string") sanitized.artifact_id = req.artifact_id;
  if (typeof req.mutation_id === "string") sanitized.mutation_id = req.mutation_id;
  if (typeof req.expected_sha256 === "string") sanitized.expected_sha256 = req.expected_sha256;
  if (req.profile) {
    const prof = sanitizeWorkerLoadProfile(req.profile);
    if (prof) sanitized.profile = prof;
  }
  if (typeof req.license_accepted === "boolean") sanitized.license_accepted = req.license_accepted;
  if (typeof req.source_root_id === "string") sanitized.source_root_id = req.source_root_id;
  if (typeof req.source_relative_path === "string") sanitized.source_relative_path = req.source_relative_path;
  if (typeof req.target_root_id === "string") sanitized.target_root_id = req.target_root_id;
  if (typeof req.scope_key === "string") sanitized.scope_key = req.scope_key;
  if (typeof req.session_hash === "string") sanitized.session_hash = req.session_hash;
  if (typeof req.invalidation_revision === "number") sanitized.invalidation_revision = req.invalidation_revision;
  if (typeof req.intent_revision === "number") sanitized.intent_revision = req.intent_revision;
  if (req.source_ref) {
    const sref = sanitizeAppSourceRef(req.source_ref);
    if (sref) sanitized.source_ref = sref;
  }
  return sanitized;
}

function computePersistenceNamespace(): string | null {
  const ctx = getServiceAccessContext();
  let deploymentId: string | undefined;
  if ("deploymentId" in ctx && typeof ctx.deploymentId === "string") {
    deploymentId = ctx.deploymentId.trim() || undefined;
  }
  const identityKey = ctx.identityKey?.trim() || undefined;
  if (!deploymentId || !identityKey) {
    return null;
  }
  const safeDep = encodeURIComponent(deploymentId);
  const safeOwner = encodeURIComponent(identityKey);
  return `deploy:${safeDep}:owner:${safeOwner}`;
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

function mergeHostRecoveryStatus(
  existing: HostRecoveryStatus | undefined,
  incoming: HostRecoveryStatus | undefined,
  existingLifecycleRev?: number,
  incomingLifecycleRev?: number
): HostRecoveryStatus | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const keepDesired =
    typeof existing.desired_revision === "number" &&
    typeof incoming.desired_revision === "number" &&
    existing.desired_revision > incoming.desired_revision;

  let keepObserved = false;
  if (
    typeof existing.reconciled_revision === "number" &&
    typeof incoming.reconciled_revision === "number"
  ) {
    if (existing.reconciled_revision > incoming.reconciled_revision) {
      keepObserved = true;
    } else if (existing.reconciled_revision === incoming.reconciled_revision) {
      if (
        typeof existingLifecycleRev === "number" &&
        typeof incomingLifecycleRev === "number"
      ) {
        if (existingLifecycleRev > incomingLifecycleRev) {
          keepObserved = true;
        }
      }
    }
  }

  return {
    desired_revision: keepDesired ? existing.desired_revision : incoming.desired_revision,
    auto_load_model: keepDesired ? existing.auto_load_model : incoming.auto_load_model,
    auto_prepare_kv: keepDesired ? existing.auto_prepare_kv : incoming.auto_prepare_kv,

    reconciled_revision: keepObserved ? existing.reconciled_revision : incoming.reconciled_revision,
    model_ready: keepObserved ? existing.model_ready : incoming.model_ready,
    cache_ready: keepObserved ? existing.cache_ready : incoming.cache_ready,
    model_action: keepObserved ? existing.model_action : incoming.model_action,
    cache_action: keepObserved ? existing.cache_action : incoming.cache_action,
  };
}

function shouldAcceptRecoveryUpdate(
  existing: OperatorRecoveryView | undefined,
  incoming: OperatorRecoveryView
): boolean {
  if (!existing) return true;
  if (existing.requested_credential_generation > incoming.requested_credential_generation) {
    return false;
  }
  if (existing.requested_credential_generation < incoming.requested_credential_generation) {
    return true;
  }
  const isExistingTerminal = existing.status !== "pending_approval";
  const isIncomingTerminal = incoming.status !== "pending_approval";
  if (isExistingTerminal && !isIncomingTerminal) {
    return false;
  }
  if (existing.approval_revision > incoming.approval_revision) {
    return false;
  }
  if (existing.approval_revision < incoming.approval_revision) {
    return true;
  }
  return true;
}

function operationSnapshotToCanonical(op: OperationSnapshot): CanonicalOperationSnapshot {
  let status: CanonicalOperationSnapshot["status"] = "active";
  if (
    op.state === "completed" ||
    op.state === "failed" ||
    op.state === "cancelled" ||
    op.state === "indeterminate"
  ) {
    status = op.state;
  } else if (op.state === "queued") {
    status = "pending";
  } else if (op.state === "cancelling") {
    status = "active";
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
    host_id: op.host_id,
    state: op.state,
    kind: op.kind,
  };
}

const MAX_PERSISTED_MUTATIONS = 50;
const MUTATION_STORAGE_KEY_PREFIX = "eigen-air:persisted-mutations:ns:";
const INSTALLATION_STORAGE_KEY_PREFIX = "eigen-air:active-installation-id:ns:";

function cleanupLegacyStorageKeys() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (!k) continue;
      if (k === "eigen-air:active-installation-id") {
        keysToRemove.push(k);
      } else if (
        k.startsWith("eigen-air:persisted-mutations:") &&
        !k.startsWith(MUTATION_STORAGE_KEY_PREFIX)
      ) {
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

function loadPersistedInstallationId(): string | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  cleanupLegacyStorageKeys();
  const ns = computePersistenceNamespace();
  if (!ns) return null;
  try {
    return window.sessionStorage.getItem(`${INSTALLATION_STORAGE_KEY_PREFIX}${ns}`);
  } catch {
    return null;
  }
}

function savePersistedInstallationId(id: string | null) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  cleanupLegacyStorageKeys();
  const ns = computePersistenceNamespace();
  if (!ns) return;
  try {
    const key = `${INSTALLATION_STORAGE_KEY_PREFIX}${ns}`;
    if (id) {
      window.sessionStorage.setItem(key, id);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function loadPersistedMutations(): Record<string, PersistedMutation> {
  if (typeof window === "undefined" || !window.sessionStorage) return {};
  cleanupLegacyStorageKeys();
  try {
    const ns = computePersistenceNamespace();
    if (!ns) return {};
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
        const item = v as Record<string, unknown>;
        const timestamp = typeof item.timestamp === "number" ? item.timestamp : 0;
        if (now - timestamp < TTL_MS) {
          const req =
            item.request && typeof item.request === "object"
              ? sanitizeAllowlistedOperationRequest(item.request as HostOperationRequest)
              : undefined;
          valid[k] = {
            mutationId: String(item.mutationId),
            hostId: String(item.hostId),
            kind: String(item.kind),
            artifactId: typeof item.artifactId === "string" ? item.artifactId : undefined,
            operationId: typeof item.operationId === "string" ? item.operationId : undefined,
            status: typeof item.status === "string" ? (item.status as PersistedMutationStatus) : undefined,
            timestamp,
            request: req,
          };
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
  cleanupLegacyStorageKeys();
  try {
    const ns = computePersistenceNamespace();
    if (!ns) return;
    const entries = Object.entries(mutations).slice(-MAX_PERSISTED_MUTATIONS);
    const map = Object.fromEntries(entries);
    window.sessionStorage.setItem(`${MUTATION_STORAGE_KEY_PREFIX}${ns}`, JSON.stringify(map));
  } catch {
    // ignore quota error
  }
}

let lastFetchHostsStartedMs = 0;
let activeReconciliationPromise: Promise<void> | null = null;
let activeReconciliationScope: string | null = null;
let lastFetchRecoveriesStartedMs = 0;
let activeFetchRecoveriesPromise: Promise<void> | null = null;

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
    activeInstallationId: loadPersistedInstallationId(),
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
        activeInstallationId: loadPersistedInstallationId(),
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
      const activeOps = Object.values(get().operations).filter(
        (op) =>
          op.status === "active" ||
          op.status === "pending" ||
          op.state === "running" ||
          op.state === "queued" ||
          op.state === "cancelling"
      );
      for (const op of activeOps) {
        void get().pollActiveOperation(op.operation_id);
      }
    },

    // --- Phase 12 Gateway Actions ---

    fetchHosts: async () => {
      const startKey = get().accessKey;
      const requestStartedMs = Date.now();
      lastFetchHostsStartedMs = requestStartedMs;
      set({ loadingHosts: true, hostsError: null });
      try {
        const list = await getInferenceService().listHosts();
        if (get().accessKey !== startKey || requestStartedMs < lastFetchHostsStartedMs) return;
        const map: Record<string, HostView> = { ...get().hosts };
        for (const h of list) {
          const existing = map[h.host_id];
          if (!existing) {
            map[h.host_id] = h;
          } else {
            const keepLifecycle = existing.lifecycle_revision > h.lifecycle_revision;
            const keepBinding = existing.applied_binding_revision > h.applied_binding_revision;
            const mergedRecovery = mergeHostRecoveryStatus(
              existing.recovery,
              h.recovery,
              existing.lifecycle_revision,
              h.lifecycle_revision
            );
            map[h.host_id] = {
              ...h,
              is_connected: keepLifecycle ? existing.is_connected : h.is_connected,
              lease_valid: keepLifecycle ? existing.lease_valid : h.lease_valid,
              current_binding: keepBinding ? existing.current_binding : h.current_binding,
              applied_binding_revision: keepBinding
                ? existing.applied_binding_revision
                : h.applied_binding_revision,
              recovery: mergedRecovery ?? h.recovery,
              lifecycle_revision: Math.max(existing.lifecycle_revision, h.lifecycle_revision),
            };
          }
        }
        set({ hosts: map, loadingHosts: false });
      } catch (e: unknown) {
        if (get().accessKey !== startKey || requestStartedMs < lastFetchHostsStartedMs) return;
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
            currentOps[op.operation_id] = operationSnapshotToCanonical(op);
          }
          if (op.state === "running" || op.state === "queued" || op.state === "cancelling") {
            void get().pollActiveOperation(op.operation_id);
          }
        }
        set((state) => {
          const existingList = state.hostOperations[hostId] ?? [];
          const existingMap = new Map(existingList.map((item) => [item.operation_id, item]));
          const mergedList: OperationSnapshot[] = [];
          for (const op of ops) {
            const ex = existingMap.get(op.operation_id);
            if (!ex || op.revision >= ex.revision) {
              mergedList.push(op);
              existingMap.delete(op.operation_id);
            } else {
              mergedList.push(ex);
              existingMap.delete(op.operation_id);
            }
          }
          for (const remaining of existingMap.values()) {
            mergedList.push(remaining);
          }
          return {
            operations: currentOps,
            hostOperations: {
              ...state.hostOperations,
              [hostId]: mergedList,
            },
          };
        });
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
            const hostId = op.host_id;
            let nextHostOps = state.hostOperations;
            if (hostId) {
              const list = state.hostOperations[hostId] ?? [];
              const idx = list.findIndex((item) => item.operation_id === op.operation_id);
              const updatedList =
                idx >= 0
                  ? list.map((item, i) =>
                      i === idx ? (op.revision >= item.revision ? op : item) : item
                    )
                  : [op, ...list];
              nextHostOps = {
                ...state.hostOperations,
                [hostId]: updatedList,
              };
            }
            const isTerminal =
              op.state === "completed" ||
              op.state === "failed" ||
              op.state === "cancelled" ||
              op.state === "indeterminate";
            if (isTerminal) {
              let changed = false;
              const nextMutations = { ...state.persistedMutations };
              for (const [k, m] of Object.entries(nextMutations)) {
                if (
                  m.operationId === op.operation_id ||
                  m.mutationId === op.operation_id ||
                  m.mutationId === op.mutation_id
                ) {
                  delete nextMutations[k];
                  changed = true;
                }
              }
              if (changed) {
                savePersistedMutations(nextMutations);
                return {
                  operations: nextOps,
                  hostOperations: nextHostOps,
                  persistedMutations: nextMutations,
                };
              }
            }
            return { operations: nextOps, hostOperations: nextHostOps };
          });
        }
      } catch {
        // ignore targeted poll failure
      }
    },

    fetchCredentialRecoveries: async () => {
      if (activeFetchRecoveriesPromise) {
        return activeFetchRecoveriesPromise;
      }
      const startKey = get().accessKey;
      const requestStartedMs = Date.now();
      lastFetchRecoveriesStartedMs = requestStartedMs;
      set({ loadingRecoveries: true, recoveriesError: null });

      activeFetchRecoveriesPromise = (async () => {
        try {
          const list = await getInferenceService().listCredentialRecoveries();
          if (get().accessKey !== startKey || requestStartedMs < lastFetchRecoveriesStartedMs) {
            return;
          }
          const currentRecoveries = get().credentialRecoveries;
          const map: Record<string, OperatorRecoveryView> = { ...currentRecoveries };
          for (const r of list) {
            const existing = currentRecoveries[r.request_id];
            if (existing && !shouldAcceptRecoveryUpdate(existing, r)) {
              continue;
            }
            map[r.request_id] = r;
          }
          set({ credentialRecoveries: map, loadingRecoveries: false });
        } catch (e: unknown) {
          if (get().accessKey !== startKey || requestStartedMs < lastFetchRecoveriesStartedMs) {
            return;
          }
          const msg = e instanceof Error ? e.message : "Failed to fetch recoveries";
          set({ recoveriesError: msg, loadingRecoveries: false });
        } finally {
          activeFetchRecoveriesPromise = null;
        }
      })();

      return activeFetchRecoveriesPromise;
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
        const prev = get().installations[installationId];
        set((state) => ({
          installations: {
            ...state.installations,
            [installationId]: status,
          },
        }));
        const stateChanged =
          !prev ||
          prev.enrolled !== status.enrolled ||
          prev.connected !== status.connected ||
          prev.host_id !== status.host_id;
        const hostId = status.host_id;
        const knownHost = hostId ? get().hosts[hostId] : undefined;
        const hostNeedsSync =
          Boolean(hostId && (!knownHost || (status.connected && !knownHost.is_connected)));
        if (stateChanged || hostNeedsSync) {
          if (status.enrolled || status.connected || status.host_id) {
            void get().fetchHosts();
          }
        }
        return status;
      } catch {
        return null;
      }
    },

    setActiveInstallationId: (id: string | null) => {
      savePersistedInstallationId(id);
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
      const now = Date.now();
      const TTL_MS = 24 * 60 * 60 * 1000;

      // Clean up expired and terminal entries before checking capacity
      const currentMutations = get().persistedMutations;
      const retainedMutations: Record<string, PersistedMutation> = {};
      for (const [k, m] of Object.entries(currentMutations)) {
        if (now - m.timestamp >= TTL_MS) continue;
        if (
          m.status === "completed" ||
          m.status === "failed" ||
          m.status === "cancelled" ||
          m.status === "indeterminate"
        ) {
          continue;
        }
        retainedMutations[k] = m;
      }

      if (Object.keys(retainedMutations).length >= MAX_PERSISTED_MUTATIONS && !retainedMutations[mutationId]) {
        throw new Error(
          `Mutation capacity exceeded: maximum ${MAX_PERSISTED_MUTATIONS} active mutations allowed`
        );
      }

      const allowlistedRequest = sanitizeAllowlistedOperationRequest(req);
      if (allowlistedRequest) {
        allowlistedRequest.mutation_id = mutationId;
      }
      const persisted: PersistedMutation = {
        mutationId,
        hostId,
        kind: req.kind,
        artifactId,
        timestamp: now,
        status: "pending_dispatch",
        request: allowlistedRequest,
      };

      const nextMutations = {
        ...retainedMutations,
        [mutationId]: persisted,
      };
      savePersistedMutations(nextMutations);
      set({ persistedMutations: nextMutations });

      const opReq: HostOperationRequest = {
        ...req,
        mutation_id: mutationId,
      };

      try {
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
      } catch (err) {
        if (get().accessKey === startKey) {
          set((state) => {
            const existing = state.persistedMutations[mutationId];
            if (existing && !existing.operationId) {
              const updated = {
                ...state.persistedMutations,
                [mutationId]: {
                  ...existing,
                  status: "ambiguous",
                },
              };
              savePersistedMutations(updated);
              return { persistedMutations: updated };
            }
            return {};
          });
        }
        throw err;
      }
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
      set((state) => {
        const existing = state.credentialRecoveries[requestId];
        if (existing && !shouldAcceptRecoveryUpdate(existing, updated)) {
          return state;
        }
        return {
          credentialRecoveries: {
            ...state.credentialRecoveries,
            [requestId]: updated,
          },
        };
      });
      await get().fetchCredentialRecoveries();
    },

    denyCredentialRecovery: async (requestId: string, expectedRevision?: number) => {
      const startKey = get().accessKey;
      const updated = await getInferenceService().denyCredentialRecovery(requestId, expectedRevision);
      if (get().accessKey !== startKey) return;
      set((state) => {
        const existing = state.credentialRecoveries[requestId];
        if (existing && !shouldAcceptRecoveryUpdate(existing, updated)) {
          return state;
        }
        return {
          credentialRecoveries: {
            ...state.credentialRecoveries,
            [requestId]: updated,
          },
        };
      });
      await get().fetchCredentialRecoveries();
    },

    applyHostUpdatedEvent: (payload: InferenceHostUpdatedPayload) => {
      set((state) => {
        const existing = state.hosts[payload.host_id];
        if (!existing) return state;
        const keepLifecycle =
          typeof payload.revision === "number" && existing.lifecycle_revision > payload.revision;
        const payloadRev =
          typeof payload.revision === "number" ? payload.revision : existing.lifecycle_revision;
        const mergedRecovery = payload.recovery
          ? mergeHostRecoveryStatus(
              existing.recovery,
              payload.recovery,
              existing.lifecycle_revision,
              payloadRev
            )
          : existing.recovery;
        return {
          hosts: {
            ...state.hosts,
            [payload.host_id]: {
              ...existing,
              is_connected: keepLifecycle
                ? existing.is_connected
                : typeof payload.is_connected === "boolean"
                ? payload.is_connected
                : existing.is_connected,
              lease_valid: keepLifecycle
                ? existing.lease_valid
                : typeof payload.lease_valid === "boolean"
                ? payload.lease_valid
                : existing.lease_valid,
              recovery: mergedRecovery ?? existing.recovery,
              lifecycle_revision:
                typeof payload.revision === "number"
                  ? Math.max(existing.lifecycle_revision, payload.revision)
                  : existing.lifecycle_revision,
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
        if (!existing) {
          void get().fetchCredentialRecoveries();
          return state;
        }
        const rawPayload = payload as { revision?: number };
        const incomingRev = payload.approval_revision ?? rawPayload.revision;
        // Unorderable hints without revision/generation must NOT directly mutate state; trigger refetch
        if (typeof incomingRev !== "number") {
          void get().fetchCredentialRecoveries();
          return state;
        }
        if (existing.approval_revision > incomingRev) {
          return state;
        }
        const isExistingTerminal = existing.status !== "pending_approval";
        const isIncomingTerminal = payload.status !== "pending_approval";
        if (isExistingTerminal && !isIncomingTerminal) {
          // Terminal status can NEVER be reverted by an event
          return state;
        }
        return {
          credentialRecoveries: {
            ...state.credentialRecoveries,
            [payload.request_id]: {
              ...existing,
              status: payload.status as OperatorRecoveryView["status"],
              approval_revision: incomingRev,
            },
          },
        };
      });
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
        if (typeof event.revision !== "number") {
          void get().pollActiveOperation(event.operation_id);
          return;
        }
        const existing = get().operations[event.operation_id];
        if (!existing || event.revision > existing.revision + 1) {
          void get().pollActiveOperation(event.operation_id);
        }
        if (existing && existing.revision > event.revision) {
          return;
        }
        if (existing) {
          const nextStatus =
            event.state === "completed" ||
            event.state === "failed" ||
            event.state === "cancelled" ||
            event.state === "indeterminate"
              ? (event.state as CanonicalOperationSnapshot["status"])
              : event.state === "queued"
              ? "pending"
              : existing.status;
          const nextRevision = event.revision;
          set((state) => {
            const nextOps = {
              ...state.operations,
              [event.operation_id]: {
                ...existing,
                status: nextStatus,
                revision: nextRevision,
                updated_at_ms: Date.now(),
              },
            };
            let nextHostOps = state.hostOperations;
            const hostId = event.host_id ?? existing.host_id;
            if (hostId && state.hostOperations[hostId]) {
              const list = state.hostOperations[hostId];
              const idx = list.findIndex((item) => item.operation_id === event.operation_id);
              if (idx >= 0) {
                const current = list[idx];
                if (nextRevision >= current.revision) {
                  const updatedOp: OperationSnapshot = {
                    ...current,
                    state: (event.state as OperationState) ?? current.state,
                    revision: nextRevision,
                    updated_at_ms: Date.now(),
                  };
                  nextHostOps = {
                    ...state.hostOperations,
                    [hostId]: list.map((item, i) => (i === idx ? updatedOp : item)),
                  };
                }
              }
            }
            return { operations: nextOps, hostOperations: nextHostOps };
          });
        }
        return;
      }

      const existing = get().operations[event.operation_id];
      if (!existing || event.revision > existing.revision + 1) {
        void get().pollActiveOperation(event.operation_id);
      }
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
          event.status === "completed" ||
          event.status === "failed" ||
          event.status === "cancelled" ||
          event.status === "indeterminate"
            ? event.occurred_at_ms
            : null,
        error_code: existing?.error_code,
        error_message: existing?.error_message,
        counters: event.counters,
        host_id: event.host_id ?? existing?.host_id,
      };

      set((state) => {
        const nextOps = {
          ...state.operations,
          [event.operation_id]: snapshot,
        };
        let nextHostOps = state.hostOperations;
        const hostId = event.host_id ?? existing?.host_id;
        if (hostId && state.hostOperations[hostId]) {
          const list = state.hostOperations[hostId];
          const idx = list.findIndex((item) => item.operation_id === event.operation_id);
          if (idx >= 0) {
            const current = list[idx];
            if (event.revision >= current.revision) {
              const stateFromStatus: OperationState =
                event.status === "completed" ||
                event.status === "failed" ||
                event.status === "cancelled" ||
                event.status === "indeterminate"
                  ? event.status
                  : event.status === "pending"
                  ? "queued"
                  : "running";
              const updatedOp: OperationSnapshot = {
                ...current,
                state: stateFromStatus,
                stage: event.stage,
                revision: event.revision,
                counters: event.counters,
                updated_at_ms: event.occurred_at_ms,
                completed_at_ms: snapshot.completed_at_ms,
              };
              nextHostOps = {
                ...state.hostOperations,
                [hostId]: list.map((item, i) => (i === idx ? updatedOp : item)),
              };
            }
          }
        }
        return { operations: nextOps, hostOperations: nextHostOps };
      });
    },

    applyRunProgressEvent: (event: RunInferenceProgressEvent, contextKey?: string) => {
      const currentKey = get().accessKey;
      if (contextKey && contextKey !== currentKey) return;
      const key = `${event.session_id}:${event.run_id}:${event.turn_index}`;
      const existing = get().runProgress[key];
      if (existing && existing.revision > event.revision) {
        return;
      }
      set((state) => {
        const next = {
          ...state.runProgress,
          [key]: event,
        };
        const MAX_RUN_PROGRESS = 50;
        const keys = Object.keys(next);
        if (keys.length > MAX_RUN_PROGRESS) {
          const terminalKey = keys.find((k) => {
            const status = next[k]?.status;
            return (
              status === "completed" ||
              status === "failed" ||
              status === "cancelled" ||
              status === "indeterminate"
            );
          });
          if (terminalKey) {
            delete next[terminalKey];
          } else {
            delete next[keys[0]];
          }
        }
        return { runProgress: next };
      });
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
        if (!pool) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool ${target.pool_id}`,
            reason: `Pool ${target.pool_id} not found`,
          };
        }
        if (pool.ready_hosts === 0) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool: ${pool.pool_id}`,
            reason: "No ready hosts in pool",
          };
        }
        if (!target.model_artifact_id) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool: ${pool.pool_id}`,
            reason: "No model artifact specified for pool target",
          };
        }
        const qualifiedList = Array.isArray(pool.qualified_models) ? pool.qualified_models : [];
        if (!qualifiedList.includes(target.model_artifact_id)) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
            reason: `Model ${target.model_artifact_id} is not qualified in pool ${pool.pool_id}`,
          };
        }
        // Validate exact model_digest against authoritative catalog if known
        if (!target.model_digest) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
            reason: "No model digest specified for pool target",
          };
        }
        const expectedDigest = AUTHORITATIVE_CATALOG_DIGESTS[target.model_artifact_id];
        if (expectedDigest) {
          if (target.model_digest !== expectedDigest) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
              reason: `Model digest mismatch for ${target.model_artifact_id}`,
            };
          }
        } else if (target.model_digest.length < 32) {
          return {
            canInfer: false,
            isReady: false,
            phase: "offline",
            label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
            reason: `Unrecognized or invalid model digest for ${target.model_artifact_id}`,
          };
        }
        if (target.host_id) {
          const host = get().hosts[target.host_id];
          if (!host) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.host_id})`,
              reason: `Host ${target.host_id} not found`,
            };
          }
          if (host.current_binding?.pool_id !== target.pool_id || host.current_binding?.state !== "bound") {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.host_id})`,
              reason: `Host ${target.host_id} is not bound to pool ${pool.pool_id}`,
            };
          }
          if (!host.is_connected || host.lease_valid === false) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.host_id})`,
              reason: `Host ${target.host_id} is offline or lease invalid`,
            };
          }
          if (host.recovery && host.recovery.model_ready === false) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.host_id})`,
              reason: `Host ${target.host_id} is not model-ready`,
            };
          }
        } else {
          const poolBoundHosts = Object.values(get().hosts).filter(
            (h) => h.current_binding?.pool_id === target.pool_id && h.current_binding?.state === "bound"
          );
          if (poolBoundHosts.length === 0) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
              reason: `No bound hosts in pool ${pool.pool_id}`,
            };
          }
          const hasReadyHost = poolBoundHosts.some(
            (h) => h.is_connected && h.lease_valid !== false && (!h.recovery || h.recovery.model_ready)
          );
          if (!hasReadyHost) {
            return {
              canInfer: false,
              isReady: false,
              phase: "offline",
              label: `Pool: ${pool.pool_id} (${target.model_artifact_id})`,
              reason: `No hosts in pool ${pool.pool_id} are currently model-ready`,
            };
          }
        }
        const label = `Pool: ${pool.pool_id}`;
        return {
          canInfer: true,
          isReady: true,
          phase: "ready",
          label,
          reason: undefined,
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
      if (activeReconciliationPromise && activeReconciliationScope === startKey) {
        return activeReconciliationPromise;
      }
      activeReconciliationScope = startKey;
      activeReconciliationPromise = (async () => {
        const mutations = get().persistedMutations;
        const now = Date.now();
        const updated = { ...mutations };
        let changed = false;

        const hostsToQuery = new Set<string>();
        for (const [id, m] of Object.entries(mutations)) {
          if (now - m.timestamp > 24 * 60 * 60 * 1000) {
            delete updated[id];
            changed = true;
            continue;
          }
          if (
            m.status === "completed" ||
            m.status === "failed" ||
            m.status === "cancelled" ||
            m.status === "indeterminate"
          ) {
            delete updated[id];
            changed = true;
            continue;
          }
          if (!m.operationId && m.hostId) {
            hostsToQuery.add(m.hostId);
          }
        }

        const hostOpsCache: Record<string, OperationSnapshot[]> = {};
        if (hostsToQuery.size > 0) {
          await Promise.all(
            Array.from(hostsToQuery).map(async (hostId) => {
              try {
                hostOpsCache[hostId] = await getInferenceService().listHostOperations(hostId);
              } catch {
                hostOpsCache[hostId] = [];
              }
            })
          );
        }

        if (get().accessKey !== startKey) return;

        const pollPromises: Promise<void>[] = [];
        const terminalSnapshots: OperationSnapshot[] = [];

        for (const [id, m] of Object.entries(mutations)) {
          if (!updated[id]) continue;
          if (m.operationId) {
            pollPromises.push(get().pollActiveOperation(m.operationId));
          } else if (m.hostId) {
            const ops = hostOpsCache[m.hostId] ?? [];
            const matched = ops.find(
              (op) => op.operation_id === m.mutationId || op.mutation_id === m.mutationId
            );
            if (matched) {
              if (
                matched.state === "completed" ||
                matched.state === "failed" ||
                matched.state === "cancelled" ||
                matched.state === "indeterminate"
              ) {
                terminalSnapshots.push(matched);
                delete updated[id];
              } else {
                updated[id] = {
                  ...m,
                  operationId: matched.operation_id,
                  status: matched.state,
                };
                pollPromises.push(get().pollActiveOperation(matched.operation_id));
              }
              changed = true;
            } else {
              if (m.status !== "unknown") {
                updated[id] = {
                  ...m,
                  status: "unknown",
                };
                changed = true;
              }
            }
          }
        }

        await Promise.all(pollPromises);

        if ((changed || terminalSnapshots.length > 0) && get().accessKey === startKey) {
          set((state) => {
            const nextOps = { ...state.operations };
            let nextHostOps = state.hostOperations;
            if (terminalSnapshots.length > 0) {
              for (const op of terminalSnapshots) {
                nextOps[op.operation_id] = operationSnapshotToCanonical(op);
                if (op.host_id) {
                  const list = nextHostOps[op.host_id] ?? [];
                  const idx = list.findIndex((item) => item.operation_id === op.operation_id);
                  const updatedList =
                    idx >= 0
                      ? list.map((item, i) =>
                          i === idx ? (op.revision >= item.revision ? op : item) : item
                        )
                      : [op, ...list];
                  nextHostOps = {
                    ...nextHostOps,
                    [op.host_id]: updatedList,
                  };
                }
              }
            }
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
            return {
              operations: nextOps,
              hostOperations: nextHostOps,
              persistedMutations: merged,
            };
          });
        }
      })();

      try {
        await activeReconciliationPromise;
      } finally {
        if (activeReconciliationScope === startKey) {
          activeReconciliationPromise = null;
          activeReconciliationScope = null;
        }
      }
    },

    retryPendingMutation: async (mutationId: string) => {
      const mut = get().persistedMutations[mutationId];
      if (!mut || !mut.request) {
        throw new Error(`No pending allowlisted request found for mutation ID ${mutationId}`);
      }
      if (mut.status !== "unknown" && mut.status !== "ambiguous" && mut.status !== "failed") {
        throw new Error(`Cannot retry mutation in status ${mut.status}`);
      }
      return get().dispatchModelOperation(
        mut.hostId,
        mut.artifactId || mut.request.artifact_id || "",
        {
          ...mut.request,
          mutation_id: mut.mutationId,
        }
      );
    },
  };
});
