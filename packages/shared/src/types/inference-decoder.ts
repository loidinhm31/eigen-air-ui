import type {
  ApprovePairingResponse,
  CanonicalOperationSnapshot,
  CatalogArtifact,
  CatalogFileDescriptor,
  DeviceStatus,
  ExecutionTarget,
  InferenceOperationProgressEvent,
  ModelFamily,
  ModelInventoryItem,
  OperationStage,
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

  if (typeof obj.unit === "string") res.unit = obj.unit;
  if (typeof obj.completed_units === "number" && obj.completed_units >= 0) {
    res.completed_units = obj.completed_units;
  }
  if (typeof obj.total_units === "number" && obj.total_units >= 0) {
    res.total_units = obj.total_units;
  }
  if (typeof obj.bytes_per_second === "number" && Number.isFinite(obj.bytes_per_second)) {
    res.bytes_per_second = Math.max(0, obj.bytes_per_second);
  }
  if (typeof obj.estimated_remaining_seconds === "number" && Number.isFinite(obj.estimated_remaining_seconds)) {
    res.estimated_remaining_seconds = Math.max(0, obj.estimated_remaining_seconds);
  }
  if (typeof obj.reused_prompt_tokens === "number" && obj.reused_prompt_tokens >= 0) {
    res.reused_prompt_tokens = obj.reused_prompt_tokens;
  }
  if (typeof obj.evaluated_prompt_tokens === "number" && obj.evaluated_prompt_tokens >= 0) {
    res.evaluated_prompt_tokens = obj.evaluated_prompt_tokens;
  }
  if (typeof obj.generated_tokens === "number" && obj.generated_tokens >= 0) {
    res.generated_tokens = obj.generated_tokens;
  }
  if (typeof obj.tokens_per_second === "number" && Number.isFinite(obj.tokens_per_second)) {
    res.tokens_per_second = Math.max(0, obj.tokens_per_second);
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
