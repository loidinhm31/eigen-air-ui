import type {
  ApprovePairingResponse,
  AppSourceRef,
  CanonicalOperationSnapshot,
  CatalogArtifact,
  CatalogFileDescriptor,
  DeviceStatus,
  ExactModelDescriptor,
  ExecutionTarget,
  ExecutionTargetInput,
  HostCacheStatus,
  HostModelRecommendation,
  HostRecord,
  HostRecoveryPreferences,
  HostRecoveryStatus,
  HostView,
  InferenceOperationProgressEvent,
  InstallationDescriptor,
  InstallationStatus,
  ModelFamily,
  ModelInventoryItem,
  OperationKind,
  OperationSnapshot,
  OperationStage,
  OperationState,
  OperatorRecoveryView,
  PoolBinding,
  PoolBindingState,
  PoolSummary,
  PublicDeviceSummary,
  RunInferenceProgressEvent,
  StageCounters,
  StageStatus,
  StorageRootDescriptor,
  StorageRootKind,
  StorageSelectionResponse,
  StorageSelectionStatus,
} from "./inference.js";

const VALID_STAGES: Record<OperationStage, true> = {
  download: true,
  verify: true,
  load_context: true,
  prepare_kv: true,
  save_kv: true,
  queue: true,
  prompt_prefill: true,
  generate: true,
  finalize: true,
};

const VALID_STATUSES: Record<StageStatus, true> = {
  pending: true,
  active: true,
  coalesced: true,
  completed: true,
  failed: true,
  cancelled: true,
  indeterminate: true,
};

const VALID_DEVICE_STATUSES: Record<DeviceStatus, true> = {
  active: true,
  revoked: true,
  retired: true,
};

const VALID_STORAGE_ROOT_KINDS: Record<StorageRootKind, true> = {
  model_root: true,
  cache_root: true,
  download_staging: true,
};

const VALID_MODEL_FAMILIES: Record<ModelFamily, true> = {
  gemma: true,
  qwen: true,
};
const VALID_STORAGE_SELECTION_STATUSES: Record<StorageSelectionStatus, true> = {
  requested: true,
  awaiting_local_approval: true,
  approved: true,
  cancelled: true,
  expired: true,
  failed: true,
};


export function decodeStageCounters(raw: unknown): StageCounters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const res: StageCounters = {};

  const unit = typeof obj.unit_name === "string" ? obj.unit_name : typeof obj.unit === "string" ? obj.unit : undefined;
  if (unit !== undefined) {
    res.unit = unit;
    res.unit_name = unit;
  }

  const completed = typeof obj.completed === "number" && obj.completed >= 0
    ? obj.completed
    : typeof obj.completed_units === "number" && obj.completed_units >= 0
    ? obj.completed_units
    : undefined;
  if (completed !== undefined) {
    res.completed = completed;
    res.completed_units = completed;
  }

  const total = typeof obj.total === "number" && obj.total >= 0
    ? obj.total
    : typeof obj.total_units === "number" && obj.total_units >= 0
    ? obj.total_units
    : undefined;
  if (total !== undefined) {
    res.total = total;
    res.total_units = total;
  }

  if (typeof obj.bytes_per_second === "number" && Number.isFinite(obj.bytes_per_second)) {
    res.bytes_per_second = Math.max(0, obj.bytes_per_second);
  } else if (typeof obj.rate_per_second === "number" && Number.isFinite(obj.rate_per_second)) {
    res.bytes_per_second = Math.max(0, obj.rate_per_second);
  }

  if (typeof obj.tokens_per_second === "number" && Number.isFinite(obj.tokens_per_second)) {
    res.tokens_per_second = Math.max(0, obj.tokens_per_second);
  } else if (typeof obj.rate_per_second === "number" && Number.isFinite(obj.rate_per_second)) {
    res.tokens_per_second = Math.max(0, obj.rate_per_second);
  }

  if (typeof obj.rate_per_second === "number" && Number.isFinite(obj.rate_per_second)) {
    res.rate_per_second = Math.max(0, obj.rate_per_second);
  } else {
    res.rate_per_second = res.tokens_per_second ?? res.bytes_per_second;
  }

  if (typeof obj.estimated_remaining_seconds === "number" && Number.isFinite(obj.estimated_remaining_seconds)) {
    res.estimated_remaining_seconds = Math.max(0, obj.estimated_remaining_seconds);
  }
  if (typeof obj.reused_prompt_tokens === "number" && obj.reused_prompt_tokens >= 0) {
    res.reused_prompt_tokens = obj.reused_prompt_tokens;
  }
  const promptTokens = typeof obj.prompt_tokens === "number" && obj.prompt_tokens >= 0
    ? obj.prompt_tokens
    : typeof obj.evaluated_prompt_tokens === "number" && obj.evaluated_prompt_tokens >= 0
    ? obj.evaluated_prompt_tokens
    : undefined;
  if (promptTokens !== undefined) {
    res.evaluated_prompt_tokens = promptTokens;
  }
  if (typeof obj.generated_tokens === "number" && obj.generated_tokens >= 0) {
    res.generated_tokens = obj.generated_tokens;
  }

  return res;
}

export function decodeCanonicalOperationSnapshot(raw: unknown): CanonicalOperationSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid CanonicalOperationSnapshot: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.operation_id !== "string" || !obj.operation_id) {
    throw new Error("Invalid operation_id in CanonicalOperationSnapshot");
  }
  if (typeof obj.artifact_id !== "string" || !obj.artifact_id) {
    throw new Error("Invalid artifact_id in CanonicalOperationSnapshot");
  }
  if (typeof obj.stage !== "string" || !VALID_STAGES[obj.stage as OperationStage]) {
    throw new Error(`Invalid stage in CanonicalOperationSnapshot: ${String(obj.stage)}`);
  }
  if (typeof obj.status !== "string" || !VALID_STATUSES[obj.status as StageStatus]) {
    throw new Error(`Invalid status in CanonicalOperationSnapshot: ${String(obj.status)}`);
  }

  return {
    operation_id: obj.operation_id,
    artifact_id: obj.artifact_id,
    execution_target_kind: typeof obj.execution_target_kind === "string" ? obj.execution_target_kind : "server",
    stage: obj.stage as OperationStage,
    status: obj.status as StageStatus,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    started_at_ms: typeof obj.started_at_ms === "number" ? obj.started_at_ms : 0,
    updated_at_ms: typeof obj.updated_at_ms === "number" ? obj.updated_at_ms : 0,
    completed_at_ms: typeof obj.completed_at_ms === "number" ? obj.completed_at_ms : null,
    error_code: typeof obj.error_code === "string" ? obj.error_code : null,
    error_message: typeof obj.error_message === "string" ? obj.error_message : null,
    counters: decodeStageCounters(obj.counters),
    host_id: typeof obj.host_id === "string" && obj.host_id ? obj.host_id : undefined,
    state: typeof obj.state === "string" ? (obj.state as OperationState) : undefined,
  };
}

export function decodeInferenceOperationProgressEvent(raw: unknown): InferenceOperationProgressEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid InferenceOperationProgressEvent: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.operation_id !== "string" || !obj.operation_id) {
    throw new Error("Invalid operation_id in InferenceOperationProgressEvent");
  }
  if (typeof obj.stage !== "string" || !VALID_STAGES[obj.stage as OperationStage]) {
    throw new Error(`Invalid stage in InferenceOperationProgressEvent: ${String(obj.stage)}`);
  }
  if (typeof obj.status !== "string" || !VALID_STATUSES[obj.status as StageStatus]) {
    throw new Error(`Invalid status in InferenceOperationProgressEvent: ${String(obj.status)}`);
  }

  return {
    schema_version: typeof obj.schema_version === "string" ? obj.schema_version : "inference.operation.v1",
    operation_id: obj.operation_id,
    execution_target_kind: typeof obj.execution_target_kind === "string" ? obj.execution_target_kind : "server",
    artifact_id: typeof obj.artifact_id === "string" ? obj.artifact_id : "",
    stage: obj.stage as OperationStage,
    stage_instance_id: typeof obj.stage_instance_id === "string" ? obj.stage_instance_id : "",
    attempt_id: typeof obj.attempt_id === "number" ? obj.attempt_id : 1,
    status: obj.status as StageStatus,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    elapsed_ms: typeof obj.elapsed_ms === "number" ? obj.elapsed_ms : 0,
    occurred_at_ms: typeof obj.occurred_at_ms === "number" ? obj.occurred_at_ms : Date.now(),
    counters: decodeStageCounters(obj.counters),
    host_id: typeof obj.host_id === "string" && obj.host_id ? obj.host_id : undefined,
  };
}

export function decodeRunInferenceProgressEvent(raw: unknown): RunInferenceProgressEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid RunInferenceProgressEvent: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.session_id !== "string" || !obj.session_id) {
    throw new Error("Invalid session_id in RunInferenceProgressEvent");
  }
  if (typeof obj.run_id !== "string" || !obj.run_id) {
    throw new Error("Invalid run_id in RunInferenceProgressEvent");
  }
  if (typeof obj.stage !== "string" || !VALID_STAGES[obj.stage as OperationStage]) {
    throw new Error(`Invalid stage in RunInferenceProgressEvent: ${String(obj.stage)}`);
  }
  if (typeof obj.status !== "string" || !VALID_STATUSES[obj.status as StageStatus]) {
    throw new Error(`Invalid status in RunInferenceProgressEvent: ${String(obj.status)}`);
  }

  return {
    schema_version: typeof obj.schema_version === "string" ? obj.schema_version : "run.inference.v1",
    session_id: obj.session_id,
    run_id: obj.run_id,
    turn_index: typeof obj.turn_index === "number" ? obj.turn_index : 0,
    stage: obj.stage as OperationStage,
    stage_instance_id: typeof obj.stage_instance_id === "string" ? obj.stage_instance_id : "",
    attempt_id: typeof obj.attempt_id === "number" ? obj.attempt_id : 1,
    status: obj.status as StageStatus,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    elapsed_ms: typeof obj.elapsed_ms === "number" ? obj.elapsed_ms : 0,
    occurred_at_ms: typeof obj.occurred_at_ms === "number" ? obj.occurred_at_ms : Date.now(),
    counters: decodeStageCounters(obj.counters),
  };
}

export function decodeExecutionTarget(raw: unknown): ExecutionTarget | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "server" && typeof obj.provider_id === "string") {
    return { kind: "server", provider_id: obj.provider_id };
  }
  if (
    obj.kind === "client_device" &&
    typeof obj.device_id === "string" &&
    typeof obj.model_artifact_id === "string"
  ) {
    return {
      kind: "client_device",
      device_id: obj.device_id,
      model_artifact_id: obj.model_artifact_id,
      binding_revision: typeof obj.binding_revision === "number" ? obj.binding_revision : 1,
    };
  }
  if (
    obj.kind === "pool" &&
    typeof obj.pool_id === "string" &&
    typeof obj.model_artifact_id === "string"
  ) {
    return {
      kind: "pool",
      pool_id: obj.pool_id,
      model_artifact_id: obj.model_artifact_id,
      model_digest: typeof obj.model_digest === "string" ? obj.model_digest : "",
      host_id: typeof obj.host_id === "string" ? obj.host_id : undefined,
    };
  }
  return undefined;
}

export function decodeExecutionTargetInput(raw: unknown): ExecutionTargetInput | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "server") {
    return {
      kind: "server",
      provider_id: typeof obj.provider_id === "string" ? obj.provider_id : undefined,
    };
  }
  if (
    obj.kind === "client_device" &&
    typeof obj.device_id === "string" &&
    typeof obj.model_artifact_id === "string"
  ) {
    return {
      kind: "client_device",
      device_id: obj.device_id,
      model_artifact_id: obj.model_artifact_id,
    };
  }
  if (
    obj.kind === "pool" &&
    typeof obj.pool_id === "string" &&
    typeof obj.model_artifact_id === "string"
  ) {
    return {
      kind: "pool",
      pool_id: obj.pool_id,
      model_artifact_id: obj.model_artifact_id,
      model_digest: typeof obj.model_digest === "string" ? obj.model_digest : undefined,
      host_id: typeof obj.host_id === "string" ? obj.host_id : undefined,
    };
  }
  return undefined;
}

export function decodePublicDeviceSummary(raw: unknown): PublicDeviceSummary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid PublicDeviceSummary: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.device_id !== "string" || !obj.device_id) {
    throw new Error("Invalid device_id in PublicDeviceSummary");
  }
  if (typeof obj.display_label !== "string") {
    throw new Error("Invalid display_label in PublicDeviceSummary");
  }
  if (typeof obj.status !== "string" || !VALID_DEVICE_STATUSES[obj.status as DeviceStatus]) {
    throw new Error(`Invalid device status: ${String(obj.status)}`);
  }

  return {
    device_id: obj.device_id,
    display_label: obj.display_label,
    status: obj.status as DeviceStatus,
    warning_archived: Boolean(obj.warning_archived),
    protocol_min_version: typeof obj.protocol_min_version === "string" ? obj.protocol_min_version : "1.0",
    protocol_max_version: typeof obj.protocol_max_version === "string" ? obj.protocol_max_version : "1.0",
    runtime_metadata:
      obj.runtime_metadata && typeof obj.runtime_metadata === "object" && !Array.isArray(obj.runtime_metadata)
        ? (obj.runtime_metadata as Record<string, unknown>)
        : {},
    created_at: typeof obj.created_at === "number" ? obj.created_at : 0,
    updated_at: typeof obj.updated_at === "number" ? obj.updated_at : 0,
    last_seen_at: typeof obj.last_seen_at === "number" ? obj.last_seen_at : null,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
  };
}

export function decodeModelInventoryItem(raw: unknown): ModelInventoryItem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid ModelInventoryItem: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.artifact_id !== "string" || !obj.artifact_id) {
    throw new Error("Invalid artifact_id in ModelInventoryItem");
  }
  const family = VALID_MODEL_FAMILIES[obj.family as ModelFamily] ? (obj.family as ModelFamily) : "gemma";

  return {
    artifact_id: obj.artifact_id,
    family,
    display_name: typeof obj.display_name === "string" ? obj.display_name : obj.artifact_id,
    quantization: typeof obj.quantization === "string" ? obj.quantization : "unknown",
    installed: Boolean(obj.installed ?? obj.is_installed),
    installed_bytes:
      typeof obj.installed_bytes === "number"
        ? obj.installed_bytes
        : typeof obj.size_bytes === "number" && Boolean(obj.installed ?? obj.is_installed)
        ? obj.size_bytes
        : undefined,
    is_loaded: Boolean(obj.is_loaded),
    has_kv_cache: Boolean(obj.has_kv_cache),
    root_id: typeof obj.root_id === "string" ? obj.root_id : undefined,
    active_operation_id: typeof obj.active_operation_id === "string" ? obj.active_operation_id : null,
    license: typeof obj.license === "string" ? obj.license : undefined,
  };
}

export function decodeStorageRootDescriptor(raw: unknown): StorageRootDescriptor {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid StorageRootDescriptor: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.root_id !== "string" || !obj.root_id) {
    throw new Error("Invalid root_id in StorageRootDescriptor");
  }
  const kind = VALID_STORAGE_ROOT_KINDS[obj.kind as StorageRootKind]
    ? (obj.kind as StorageRootKind)
    : "model_root";

  return {
    root_id: obj.root_id,
    kind,
    display_label: typeof obj.display_label === "string" ? obj.display_label : obj.root_id,
    total_bytes: typeof obj.total_bytes === "number" ? obj.total_bytes : 0,
    available_bytes: typeof obj.available_bytes === "number" ? obj.available_bytes : 0,
    is_removable: Boolean(obj.is_removable),
    is_read_only: Boolean(obj.is_read_only),
  };
}

export function decodeCatalogArtifact(raw: unknown): CatalogArtifact {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid CatalogArtifact: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.artifact_id !== "string" || !obj.artifact_id) {
    throw new Error("Invalid artifact_id in CatalogArtifact");
  }
  const family = VALID_MODEL_FAMILIES[obj.family as ModelFamily] ? (obj.family as ModelFamily) : "gemma";

  const files: CatalogFileDescriptor[] = Array.isArray(obj.files)
    ? obj.files
        .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object" && !Array.isArray(f)))
        .map((f) => ({
          filename: typeof f.filename === "string" ? f.filename : "model.gguf",
          size_bytes: typeof f.size_bytes === "number" ? f.size_bytes : 0,
          sha256: typeof f.sha256 === "string" ? f.sha256 : "",
          urls: Array.isArray(f.urls) ? f.urls.filter((u): u is string => typeof u === "string") : [],
        }))
    : [];

  return {
    artifact_id: obj.artifact_id,
    family,
    display_name: typeof obj.display_name === "string" ? obj.display_name : obj.artifact_id,
    quantization: typeof obj.quantization === "string" ? obj.quantization : "unknown",
    publisher: typeof obj.publisher === "string" ? obj.publisher : "unknown",
    repository: typeof obj.repository === "string" ? obj.repository : "",
    revision: typeof obj.revision === "string" ? obj.revision : "1",
    files,
    license_id: typeof obj.license_id === "string" ? obj.license_id : "unknown",
    license_url: typeof obj.license_url === "string" ? obj.license_url : "",
    requires_acceptance: Boolean(obj.requires_acceptance),
    context_cap: typeof obj.context_cap === "number" ? obj.context_cap : 4096,
    runtime_min_version: typeof obj.runtime_min_version === "string" ? obj.runtime_min_version : "0.1.0",
    recommended_ram_bytes: typeof obj.recommended_ram_bytes === "number" ? obj.recommended_ram_bytes : 0,
    recommended_vram_bytes: typeof obj.recommended_vram_bytes === "number" ? obj.recommended_vram_bytes : 0,
  };
}

export function decodeApprovePairingResponse(raw: unknown): ApprovePairingResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid ApprovePairingResponse: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.pairing_id !== "string" || !obj.pairing_id) {
    throw new Error("Invalid pairing_id in ApprovePairingResponse");
  }
  if (typeof obj.status !== "string" || !obj.status) {
    throw new Error("Invalid status in ApprovePairingResponse");
  }
  if (typeof obj.expires_at_ms !== "number" || obj.expires_at_ms <= 0) {
    throw new Error("Invalid expires_at_ms in ApprovePairingResponse");
  }
  return {
    status: obj.status,
    pairing_id: obj.pairing_id,
    expires_at_ms: obj.expires_at_ms,
  };
}

export function decodeStorageSelectionResponse(raw: unknown): StorageSelectionResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid StorageSelectionResponse: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.request_id !== "string" || !obj.request_id) {
    throw new Error("Invalid request_id in StorageSelectionResponse");
  }
  if (typeof obj.device_id !== "string" || !obj.device_id) {
    throw new Error("Invalid device_id in StorageSelectionResponse");
  }
  if (typeof obj.kind !== "string" || !VALID_STORAGE_ROOT_KINDS[obj.kind as StorageRootKind]) {
    throw new Error(`Invalid kind in StorageSelectionResponse: ${String(obj.kind)}`);
  }
  if (typeof obj.status !== "string" || !VALID_STORAGE_SELECTION_STATUSES[obj.status as StorageSelectionStatus]) {
    throw new Error(`Invalid status in StorageSelectionResponse: ${String(obj.status)}`);
  }
  if (typeof obj.expires_at_ms !== "number" || obj.expires_at_ms <= 0) {
    throw new Error("Invalid expires_at_ms in StorageSelectionResponse");
  }

  return {
    request_id: obj.request_id,
    device_id: obj.device_id,
    kind: obj.kind as StorageRootKind,
    status: obj.status as StorageSelectionStatus,
    expires_at_ms: obj.expires_at_ms,
    approved_root_id: typeof obj.approved_root_id === "string" ? obj.approved_root_id : undefined,
    approved_label: typeof obj.approved_label === "string" ? obj.approved_label : undefined,
    error_message: typeof obj.error_message === "string" ? obj.error_message : undefined,
  };
}

// --- Phase 12 Decoders ---

export function decodePoolBinding(raw: unknown): PoolBinding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid PoolBinding: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.host_id !== "string" || !obj.host_id) {
    throw new Error("Invalid host_id in PoolBinding");
  }
  if (typeof obj.pool_id !== "string" || !obj.pool_id) {
    throw new Error("Invalid pool_id in PoolBinding");
  }
  const state = typeof obj.state === "string" && ["unbound", "bound", "draining"].includes(obj.state)
    ? (obj.state as PoolBindingState)
    : "unbound";

  return {
    host_id: obj.host_id,
    pool_id: obj.pool_id,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    state,
    changed_at_ms: typeof obj.changed_at_ms === "number" ? obj.changed_at_ms : 0,
  };
}

export function decodePoolSummary(raw: unknown): PoolSummary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid PoolSummary: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.pool_id !== "string" || !obj.pool_id) {
    throw new Error("Invalid pool_id in PoolSummary");
  }
  return {
    pool_id: obj.pool_id,
    ready_hosts: typeof obj.ready_hosts === "number" ? obj.ready_hosts : 0,
    busy_hosts: typeof obj.busy_hosts === "number" ? obj.busy_hosts : 0,
    offline_hosts: typeof obj.offline_hosts === "number" ? obj.offline_hosts : 0,
    qualified_models: Array.isArray(obj.qualified_models)
      ? obj.qualified_models.filter((m): m is string => typeof m === "string")
      : [],
  };
}

export function decodeHostRecord(raw: unknown): HostRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid HostRecord: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.host_id !== "string" || !obj.host_id) {
    throw new Error("Invalid host_id in HostRecord");
  }
  return {
    host_id: obj.host_id,
    installation_id: typeof obj.installation_id === "string" ? obj.installation_id : "",
    label: typeof obj.label === "string" ? obj.label : obj.host_id,
    platform: typeof obj.platform === "string" ? obj.platform : "unknown",
    agent_version: typeof obj.agent_version === "string" ? obj.agent_version : "",
    lifecycle_revision: typeof obj.lifecycle_revision === "number" ? obj.lifecycle_revision : 0,
    desired_binding: typeof obj.desired_binding === "string" ? obj.desired_binding : null,
    last_seen_at_ms: typeof obj.last_seen_at_ms === "number" ? obj.last_seen_at_ms : 0,
  };
}

export function decodeHostRecoveryStatus(raw: unknown): HostRecoveryStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      desired_revision: 0,
      reconciled_revision: 0,
      auto_load_model: false,
      auto_prepare_kv: false,
      model_ready: false,
      cache_ready: false,
      model_action: "none",
      cache_action: "none",
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    desired_revision: typeof obj.desired_revision === "number" ? obj.desired_revision : 0,
    reconciled_revision: typeof obj.reconciled_revision === "number" ? obj.reconciled_revision : 0,
    auto_load_model: Boolean(obj.auto_load_model),
    auto_prepare_kv: Boolean(obj.auto_prepare_kv),
    model_ready: Boolean(obj.model_ready),
    cache_ready: Boolean(obj.cache_ready),
    model_action: typeof obj.model_action === "string" ? obj.model_action : "none",
    cache_action: typeof obj.cache_action === "string" ? obj.cache_action : "none",
  };
}

export function decodeHostView(raw: unknown): HostView {
  const base = decodeHostRecord(raw);
  const obj = raw as Record<string, unknown>;
  return {
    ...base,
    is_connected: Boolean(obj.is_connected),
    lease_valid: Boolean(obj.lease_valid),
    current_binding: obj.current_binding ? decodePoolBinding(obj.current_binding) : null,
    recovery: decodeHostRecoveryStatus(obj.recovery),
    applied_binding_revision: typeof obj.applied_binding_revision === "number" ? obj.applied_binding_revision : 0,
  };
}

export function decodeExactModelDescriptor(raw: unknown): ExactModelDescriptor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.artifact_id !== "string" || !obj.artifact_id) return null;
  const prof = obj.profile && typeof obj.profile === "object" ? (obj.profile as Record<string, unknown>) : {};
  return {
    artifact_id: obj.artifact_id,
    verified_model_sha256: typeof obj.verified_model_sha256 === "string" ? obj.verified_model_sha256 : "",
    settings_digest: typeof obj.settings_digest === "string" ? obj.settings_digest : "",
    profile: {
      context_tokens: typeof prof.context_tokens === "number" ? prof.context_tokens : 4096,
      batch_tokens: typeof prof.batch_tokens === "number" ? prof.batch_tokens : 512,
      ubatch_tokens: typeof prof.ubatch_tokens === "number" ? prof.ubatch_tokens : 512,
      threads: typeof prof.threads === "number" ? prof.threads : 0,
      gpu_layers: typeof prof.gpu_layers === "number" ? prof.gpu_layers : 0,
      device_index: typeof prof.device_index === "number" ? prof.device_index : null,
      kv_placement: typeof prof.kv_placement === "string" ? prof.kv_placement : "cpu",
      type_k: typeof prof.type_k === "string" ? prof.type_k : "f16",
      type_v: typeof prof.type_v === "string" ? prof.type_v : "f16",
      flash_attention: Boolean(prof.flash_attention),
      swa_full: typeof prof.swa_full === "boolean" ? prof.swa_full : undefined,
      n_rs_seq: typeof prof.n_rs_seq === "number" ? prof.n_rs_seq : undefined,
    },
  };
}

export function decodeAppSourceRef(raw: unknown): AppSourceRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.scope_hash !== "string" || !obj.scope_hash) return null;
  return {
    tenant_id: typeof obj.tenant_id === "string" ? obj.tenant_id : "",
    user_id: typeof obj.user_id === "string" ? obj.user_id : "",
    workspace_id: typeof obj.workspace_id === "string" ? obj.workspace_id : "",
    session_id: typeof obj.session_id === "string" ? obj.session_id : "",
    scope_hash: obj.scope_hash,
    session_hash: typeof obj.session_hash === "string" ? obj.session_hash : "",
    prompt_profile_id: typeof obj.prompt_profile_id === "string" ? obj.prompt_profile_id : "",
    source_revision: typeof obj.source_revision === "string" ? obj.source_revision : "",
    prefix_digest: typeof obj.prefix_digest === "string" ? obj.prefix_digest : "",
    preparation_fingerprint: typeof obj.preparation_fingerprint === "string" ? obj.preparation_fingerprint : "",
  };
}

export function decodeHostRecoveryPreferences(raw: unknown): HostRecoveryPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid HostRecoveryPreferences: expected object");
  }
  const obj = raw as Record<string, unknown>;
  return {
    host_id: typeof obj.host_id === "string" ? obj.host_id : "",
    expected_revision: typeof obj.expected_revision === "number" ? obj.expected_revision : 0,
    reconciled_revision: typeof obj.reconciled_revision === "number" ? obj.reconciled_revision : 0,
    auto_load_model: Boolean(obj.auto_load_model),
    auto_prepare_kv: Boolean(obj.auto_prepare_kv),
    last_selected_model: decodeExactModelDescriptor(obj.last_selected_model),
    auto_prepare_source: decodeAppSourceRef(obj.auto_prepare_source),
  };
}

export function decodeHostModelRecommendation(raw: unknown): HostModelRecommendation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid HostModelRecommendation: expected object");
  }
  const obj = raw as Record<string, unknown>;
  const perfObj = obj.perf && typeof obj.perf === "object" ? (obj.perf as Record<string, unknown>) : {};
  const suggObj = obj.suggested_profile && typeof obj.suggested_profile === "object"
    ? (obj.suggested_profile as Record<string, unknown>)
    : null;

  let fitVal: HostModelRecommendation["fit"] = "unknown";
  if (obj.fit && typeof obj.fit === "object") {
    const fObj = obj.fit as Record<string, unknown>;
    const vKind = typeof fObj.verdict === "string" ? fObj.verdict : "unknown";
    fitVal = {
      verdict: vKind as any,
      reason: typeof fObj.reason === "string" ? fObj.reason : "",
      estimated_host_bytes: typeof fObj.estimated_host_bytes === "number" ? fObj.estimated_host_bytes : null,
      estimated_device_bytes: typeof fObj.estimated_device_bytes === "number" ? fObj.estimated_device_bytes : null,
    };
  } else if (typeof obj.fit === "string") {
    fitVal = obj.fit as any;
  }

  let suggestedProfile: HostModelRecommendation["suggested_profile"] = null;
  if (suggObj) {
    const p = suggObj.profile && typeof suggObj.profile === "object"
      ? (suggObj.profile as Record<string, unknown>)
      : suggObj;
    const contextTokens = typeof p.context_tokens === "number" ? p.context_tokens : 4096;
    const gpuLayers = typeof p.gpu_layers === "number" ? p.gpu_layers : 0;
    const kvPlacement = typeof p.kv_placement === "string" ? p.kv_placement : "cpu";
    const flashAttn = Boolean(p.flash_attention);

    suggestedProfile = {
      rung_name: typeof suggObj.rung_name === "string" ? suggObj.rung_name : undefined,
      backend: typeof suggObj.backend === "string" ? suggObj.backend : typeof p.backend === "string" ? p.backend : "cpu",
      profile_hash: typeof suggObj.profile_hash === "string" ? suggObj.profile_hash : undefined,
      device_label: typeof suggObj.device_label === "string" ? suggObj.device_label : null,
      device_index: typeof suggObj.device_index === "number" ? suggObj.device_index : typeof p.device_index === "number" ? p.device_index : null,
      context_tokens: contextTokens,
      gpu_layers: gpuLayers,
      kv_placement: kvPlacement,
      flash_attention: flashAttn,
      profile: suggObj.profile
        ? (suggObj.profile as any)
        : {
            context_tokens: contextTokens,
            batch_tokens: typeof p.batch_tokens === "number" ? p.batch_tokens : 512,
            ubatch_tokens: typeof p.ubatch_tokens === "number" ? p.ubatch_tokens : 512,
            threads: typeof p.threads === "number" ? p.threads : 0,
            gpu_layers: gpuLayers,
            device_index: typeof p.device_index === "number" ? p.device_index : null,
            kv_placement: kvPlacement,
            type_k: typeof p.type_k === "string" ? p.type_k : "f16",
            type_v: typeof p.type_v === "string" ? p.type_v : "f16",
            flash_attention: flashAttn,
          },
    };
  }

  const prefillVal = typeof perfObj.prefill_tps === "number"
    ? perfObj.prefill_tps
    : typeof perfObj.prefill_tokens_per_second === "number"
    ? perfObj.prefill_tokens_per_second
    : null;
  const decodeVal = typeof perfObj.decode_tps === "number"
    ? perfObj.decode_tps
    : typeof perfObj.decode_tokens_per_second === "number"
    ? perfObj.decode_tokens_per_second
    : null;

  return {
    host_id: typeof obj.host_id === "string" ? obj.host_id : "",
    artifact_id: typeof obj.artifact_id === "string" ? obj.artifact_id : "",
    fit: fitVal,
    suggested_profile: suggestedProfile,
    qualification: typeof obj.qualification === "string" && ["qualified", "unqualified", "blocked", "degraded", "unknown"].includes(obj.qualification)
      ? (obj.qualification as HostModelRecommendation["qualification"])
      : "unqualified",
    perf: {
      prefill_tps: prefillVal,
      decode_tps: decodeVal,
      prefill_tokens_per_second: prefillVal,
      decode_tokens_per_second: decodeVal,
      source: typeof perfObj.source === "string" || (perfObj.source && typeof perfObj.source === "object")
        ? (perfObj.source as any)
        : "not_measured_yet",
      measured_at_ms: typeof perfObj.measured_at_ms === "number" ? perfObj.measured_at_ms : null,
      is_stale: Boolean(perfObj.is_stale),
    },
    risks: Array.isArray(obj.risks)
      ? obj.risks.map((item: unknown) => {
          if (typeof item === "string") {
            return {
              code: item,
              message: item.replace(/_/g, " "),
              severity: item.includes("blocked") || item.includes("does_not_fit") ? "critical" : "warning",
            };
          }
          const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            code: typeof r.code === "string" ? r.code : "unknown",
            message: typeof r.message === "string" ? r.message : "",
            severity: r.severity === "critical" || r.severity === "warning" ? r.severity : "info",
          };
        })
      : [],
    rank: typeof obj.rank === "number" ? obj.rank : null,
    selectable: obj.selectable === true,
    disabled_reason: typeof obj.disabled_reason === "string" ? obj.disabled_reason : null,
  };
}

export function decodeHostCacheStatus(raw: unknown): HostCacheStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid HostCacheStatus: expected object");
  }
  const obj = raw as Record<string, unknown>;
  const validStatuses: Record<string, true> = {
    absent: true,
    partial: true,
    ready: true,
    invalid: true,
    unsupported: true,
    pending_purge: true,
  };
  return {
    host_id: typeof obj.host_id === "string" ? obj.host_id : "",
    scope_key: typeof obj.scope_key === "string" ? obj.scope_key : "",
    session_hash: typeof obj.session_hash === "string" ? obj.session_hash : null,
    status: typeof obj.status === "string" && validStatuses[obj.status]
      ? (obj.status as HostCacheStatus["status"])
      : "absent",
    committed_tokens: typeof obj.committed_tokens === "number" ? obj.committed_tokens : null,
    total_tokens: typeof obj.total_tokens === "number" ? obj.total_tokens : null,
    last_committed_generation_id: typeof obj.last_committed_generation_id === "string" ? obj.last_committed_generation_id : null,
    invalidation_revision: typeof obj.invalidation_revision === "number" ? obj.invalidation_revision : 0,
    reason: typeof obj.reason === "string" ? obj.reason : null,
  };
}

export function decodeOperatorRecoveryView(raw: unknown): OperatorRecoveryView {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid OperatorRecoveryView: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.request_id !== "string" || !obj.request_id) {
    throw new Error("Invalid request_id in OperatorRecoveryView");
  }
  return {
    request_id: obj.request_id,
    deployment_id: typeof obj.deployment_id === "string" ? obj.deployment_id : "",
    installation_id: typeof obj.installation_id === "string" ? obj.installation_id : "",
    host_id: typeof obj.host_id === "string" ? obj.host_id : "",
    public_key_fingerprint: typeof obj.public_key_fingerprint === "string" ? obj.public_key_fingerprint : "",
    requested_credential_generation: typeof obj.requested_credential_generation === "number" ? obj.requested_credential_generation : 0,
    expiry_ms: typeof obj.expiry_ms === "number" ? obj.expiry_ms : 0,
    status: typeof obj.status === "string" ? (obj.status as OperatorRecoveryView["status"]) : "pending_approval",
    approval_revision: typeof obj.approval_revision === "number" ? obj.approval_revision : 0,
    created_at_ms: typeof obj.created_at_ms === "number" ? obj.created_at_ms : 0,
    approved_at_ms: typeof obj.approved_at_ms === "number" ? obj.approved_at_ms : null,
    delivered_at_ms: typeof obj.delivered_at_ms === "number" ? obj.delivered_at_ms : null,
    acknowledged_at_ms: typeof obj.acknowledged_at_ms === "number" ? obj.acknowledged_at_ms : null,
  };
}

export function decodeInstallationDescriptor(raw: unknown): InstallationDescriptor {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid InstallationDescriptor: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.installation_id !== "string" || !obj.installation_id) {
    throw new Error("Invalid installation_id in InstallationDescriptor");
  }
  return {
    installation_id: obj.installation_id,
    platform: typeof obj.platform === "string" ? obj.platform : "unknown",
    label: typeof obj.label === "string" ? obj.label : "",
    script_url: typeof obj.script_url === "string" ? obj.script_url : `/v1/inference/installations/${obj.installation_id}/script`,
    created_at_ms: typeof obj.created_at_ms === "number" ? obj.created_at_ms : Date.now(),
  };
}

export function decodeInstallationStatus(raw: unknown): InstallationStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid InstallationStatus: expected object");
  }
  const obj = raw as Record<string, unknown>;
  const enrolled = typeof obj.enrolled === "boolean" ? obj.enrolled : false;
  const connected = typeof obj.connected === "boolean" ? obj.connected : false;
  const status =
    typeof obj.status === "string"
      ? obj.status
      : connected
      ? "connected"
      : enrolled
      ? "enrolled"
      : "pending";
  const hostId = typeof obj.host_id === "string" && obj.host_id ? obj.host_id : null;

  const registeredHosts = Array.isArray(obj.registered_hosts)
    ? obj.registered_hosts.filter((h): h is string => typeof h === "string")
    : hostId && enrolled
    ? [hostId]
    : [];
  const connectedHosts = Array.isArray(obj.connected_hosts)
    ? obj.connected_hosts.filter((h): h is string => typeof h === "string")
    : hostId && connected
    ? [hostId]
    : [];
  const boundHosts = Array.isArray(obj.bound_hosts)
    ? obj.bound_hosts.filter((h): h is string => typeof h === "string")
    : [];

  return {
    installation_id: typeof obj.installation_id === "string" ? obj.installation_id : "",
    deployment_id: typeof obj.deployment_id === "string" ? obj.deployment_id : undefined,
    platform: typeof obj.platform === "string" ? obj.platform : "unknown",
    label: typeof obj.label === "string" ? obj.label : "",
    status,
    enrolled,
    connected,
    host_id: hostId,
    proof_fingerprint: typeof obj.proof_fingerprint === "string" ? obj.proof_fingerprint : null,
    last_seen_ms: typeof obj.last_seen_ms === "number" ? obj.last_seen_ms : null,
    created_at_ms: typeof obj.created_at_ms === "number" ? obj.created_at_ms : 0,
    registered_hosts: registeredHosts,
    connected_hosts: connectedHosts,
    bound_hosts: boundHosts,
  };
}

export function decodeOperationSnapshot(raw: unknown): OperationSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid OperationSnapshot: expected object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.operation_id !== "string" || !obj.operation_id) {
    throw new Error("Invalid operation_id in OperationSnapshot");
  }
  const stageCounters = obj.stage_counters ? decodeStageCounters(obj.stage_counters) : undefined;
  const counters = stageCounters ?? decodeStageCounters(obj.counters);
  const createdAt = typeof obj.created_at_ms === "number" ? obj.created_at_ms : typeof obj.started_at_ms === "number" ? obj.started_at_ms : undefined;

  const sanitizedErrObj = obj.sanitized_error && typeof obj.sanitized_error === "object"
    ? (obj.sanitized_error as Record<string, unknown>)
    : null;
  const rawMsg = sanitizedErrObj && typeof sanitizedErrObj.message === "string"
    ? sanitizedErrObj.message
    : sanitizedErrObj && typeof sanitizedErrObj.sanitized_message === "string"
    ? sanitizedErrObj.sanitized_message
    : "";
  const sanitizedError = sanitizedErrObj
    ? {
        code: typeof sanitizedErrObj.code === "string" ? sanitizedErrObj.code : "operation_error",
        message: rawMsg,
        sanitized_message: rawMsg,
      }
    : null;

  const errorMessage = typeof obj.error_message === "string" ? obj.error_message : sanitizedError?.message || null;
  const errorCode = typeof obj.error_code === "string" ? obj.error_code : sanitizedError?.code ?? null;
  return {
    operation_id: obj.operation_id,
    host_id: typeof obj.host_id === "string" ? obj.host_id : "",
    artifact_id: typeof obj.artifact_id === "string" ? obj.artifact_id : "",
    kind: typeof obj.kind === "string" ? (obj.kind as OperationKind) : "load",
    state: typeof obj.state === "string" ? (obj.state as OperationState) : "queued",
    stage: typeof obj.stage === "string" ? (obj.stage as OperationStage) : undefined,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    counters,
    stage_counters: stageCounters,
    created_at_ms: createdAt,
    started_at_ms: typeof obj.started_at_ms === "number" ? obj.started_at_ms : createdAt,
    updated_at_ms: typeof obj.updated_at_ms === "number" ? obj.updated_at_ms : undefined,
    completed_at_ms: typeof obj.completed_at_ms === "number" ? obj.completed_at_ms : null,
    error_code: errorCode,
    error_message: errorMessage,
    sanitized_error: sanitizedError,
  };
}
