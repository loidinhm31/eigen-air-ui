export type ExecutionTarget =
  | {
      kind: "server";
      provider_id: string;
    }
  | {
      kind: "client_device";
      device_id: string;
      model_artifact_id: string;
      binding_revision: number;
    };

export type ExecutionTargetInput =
  | {
      kind: "server";
      provider_id?: string;
    }
  | {
      kind: "client_device";
      device_id: string;
      model_artifact_id: string;
    };

export type OperationStage =
  | "download"
  | "verify"
  | "load_context"
  | "prepare_kv"
  | "save_kv"
  | "queue"
  | "prompt_prefill"
  | "generate"
  | "finalize";

export type StageStatus =
  | "pending"
  | "active"
  | "coalesced"
  | "completed"
  | "failed"
  | "cancelled";

export interface StageCounters {
  unit?: string;
  completed_units?: number;
  total_units?: number;
  bytes_per_second?: number;
  estimated_remaining_seconds?: number;
  reused_prompt_tokens?: number;
  evaluated_prompt_tokens?: number;
  generated_tokens?: number;
  tokens_per_second?: number;
}

export interface InferenceOperationProgressEvent {
  schema_version: string;
  operation_id: string;
  execution_target_kind: string;
  artifact_id: string;
  stage: OperationStage;
  stage_instance_id: string;
  attempt_id: number;
  status: StageStatus;
  revision: number;
  elapsed_ms: number;
  occurred_at_ms: number;
  counters: StageCounters;
}

export interface RunInferenceProgressEvent {
  schema_version: string;
  session_id: string;
  run_id: string;
  turn_index: number;
  stage: OperationStage;
  stage_instance_id: string;
  attempt_id: number;
  status: StageStatus;
  revision: number;
  elapsed_ms: number;
  occurred_at_ms: number;
  counters: StageCounters;
}

export interface CanonicalOperationSnapshot {
  operation_id: string;
  artifact_id: string;
  execution_target_kind: string;
  stage: OperationStage;
  status: StageStatus;
  revision: number;
  started_at_ms: number;
  updated_at_ms: number;
  completed_at_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  counters: StageCounters;
}

export type StorageRootKind = "model_root" | "cache_root" | "download_staging";

export interface StorageRootDescriptor {
  root_id: string;
  kind: StorageRootKind;
  display_label: string;
  total_bytes: number;
  available_bytes: number;
  is_removable: boolean;
  is_read_only: boolean;
}

export type ModelFamily = "gemma" | "qwen";

export interface CatalogFileDescriptor {
  filename: string;
  size_bytes: number;
  sha256: string;
  urls: string[];
}

export interface CatalogArtifact {
  artifact_id: string;
  family: ModelFamily;
  display_name: string;
  quantization: string;
  publisher: string;
  repository: string;
  revision: string;
  files: CatalogFileDescriptor[];
  license_id: string;
  license_url: string;
  requires_acceptance: boolean;
  context_cap: number;
  runtime_min_version: string;
  recommended_ram_bytes: number;
  recommended_vram_bytes: number;
}

export interface ModelInventoryItem {
  artifact_id: string;
  family: ModelFamily;
  display_name: string;
  quantization: string;
  installed: boolean;
  installed_bytes?: number;
  is_loaded: boolean;
  has_kv_cache: boolean;
  root_id?: string;
  active_operation_id?: string | null;
  license?: string;
}

export type DeviceStatus = "active" | "revoked" | "retired";

export interface PublicDeviceSummary {
  device_id: string;
  display_label: string;
  status: DeviceStatus;
  warning_archived: boolean;
  protocol_min_version: string;
  protocol_max_version: string;
  runtime_metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
  last_seen_at?: number | null;
  revision: number;
}

export interface DeviceRetirementOptions {
  archive_warning: boolean;
}

export type CacheCleanupState = "none" | "pending" | "acknowledged" | "deletion_unverified";

export interface StartPairingRequest {
  client_public_key: string;
  device_label: string;
  protocol_min: string;
  protocol_max: string;
  nonce: string;
}

export interface StartPairingResponse {
  pairing_id: string;
  expires_at: number;
  auth_url?: string;
}

export interface PollPairingRequest {
  nonce: string;
}

export interface PollPairingResponse {
  pairing_id: string;
  state: "pending" | "approved" | "rejected" | "expired";
  expires_at: number;
}

export interface ApprovePairingRequest {
  confirmed: boolean;
}

export interface FinalizePairingRequest {
  pairing_id: string;
  device_id: string;
}

export interface LocalCompanionStatus {
  version: string;
  status: string;
  active_root: string;
  queued_requests: number;
  model_loaded: boolean;
}

export interface ConfiguredStorageRoot {
  id: string;
  path: string;
  label: string;
  is_primary: boolean;
}

export type LocalControlCommand =
  | { cmd: "get_status" }
  | { cmd: "list_roots" }
  | { cmd: "authorize_root"; path: string; label: string }
  | { cmd: "select_active_root"; root_id: string }
  | { cmd: "list_catalog" }
  | { cmd: "list_installed_models" }
  | { cmd: "start_download"; artifact_id: string; license_accepted?: boolean }
  | { cmd: "cancel_operation"; operation_id: string }
  | { cmd: "prepare_cache"; prefix_text: string; model_id: string; max_tokens: number }
  | { cmd: "purge_cache"; namespace_hash?: string }
  | {
      cmd: "unpair";
      delete_caches: boolean;
      device_id?: string;
      tenant_id?: string;
      user_id?: string;
      enrollment_id?: string;
      namespace_hash?: string;
    }
  | { cmd: "stop_companion"; keep_running: boolean };

export type LocalControlResponse =
  | ({ response: "status" } & LocalCompanionStatus)
  | { response: "roots"; roots: ConfiguredStorageRoot[] }
  | { response: "root_authorized"; handle: { root_id: string; path: string; label: string } }
  | { response: "active_root_changed"; root_id: string }
  | { response: "catalog"; artifacts: CatalogArtifact[] }
  | { response: "installed_models"; models: ModelInventoryItem[] }
  | { response: "operation_started"; operation_id: string }
  | { response: "operation_cancelled"; operation_id: string }
  | { response: "cache_prepared"; cache_path: string; tokens: number }
  | { response: "cache_purged"; purged_count: number }
  | { response: "unpaired"; cleanup_state: string; credentials_wiped: boolean; tombstone_created: boolean }
  | { response: "stopping"; keep_running_on_exit: boolean }
  | { response: "error"; code: string; message: string };
