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
    }
  | {
      kind: "pool";
      pool_id: string;
      model_artifact_id: string;
      model_digest: string;
      host_id?: string;
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
    }
  | {
      kind: "pool";
      pool_id: string;
      model_artifact_id: string;
      model_digest?: string;
      host_id?: string;
    };

export const AUTHORITATIVE_CATALOG_DIGESTS: Record<string, string> = {
  "gemma-4-e4b-it-qat-ud-q4_k_xl": "df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3",
  "qwen-3.5-9b-ud-q4_k_xl": "6f5d30666c2d8ae16a306e616d95341dcf3cc46810df84d7e6f5a7d1e4c1b293",
  "qwen-3.5-4b-ud-q4_k_xl": "b252c5610a42ca82d20fe2a12813e9d069eed89292907e26c783eeb0bc961bc7",
  "qwen-3.8-27b-ud-q4_k_xl": "3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e",
  "gemma-4-e4b-it-qat-q4_0": "e8b6a059ba86947a44ace84d6e5679795bc41862c25c30513142588f0e9dba1d",
};

export function resolveAuthoritativeModelDigest(artifactId: string): string {
  return AUTHORITATIVE_CATALOG_DIGESTS[artifactId] || "";
}
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
  unit_name?: string;
  completed?: number;
  completed_units?: number;
  total?: number;
  total_units?: number;
  rate_per_second?: number;
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
  code: string;
  confirmed?: boolean;
}

export interface ApprovePairingResponse {
  status: string;
  pairing_id: string;
  expires_at_ms: number;
}

export type StorageSelectionStatus =
  | "requested"
  | "awaiting_local_approval"
  | "approved"
  | "cancelled"
  | "expired"
  | "failed";

export interface StorageSelectionRequest {
  kind?: StorageRootKind;
  request_id?: string;
  label?: string;
}

export interface StorageSelectionResponse {
  request_id: string;
  device_id: string;
  kind: StorageRootKind;
  status: StorageSelectionStatus;
  expires_at_ms: number;
  approved_root_id?: string;
  approved_label?: string;
  error_message?: string;
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

// --- Phase 12 Managed Gateway & Host Types ---

export type PoolBindingState = "unbound" | "bound" | "draining";

export interface PoolRecord {
  pool_id: string;
  name: string;
  description: string;
  revision: number;
  created_at_ms: number;
}

export interface PoolBinding {
  host_id: string;
  pool_id: string;
  revision: number;
  state: PoolBindingState;
  changed_at_ms: number;
}

export interface PoolBindingMutation {
  pool_id: string;
  expected_revision?: number;
  mutation_id: string;
}

export interface PoolSummary {
  pool_id: string;
  ready_hosts: number;
  busy_hosts: number;
  offline_hosts: number;
  qualified_models: string[];
}

export interface HostRecord {
  host_id: string;
  installation_id: string;
  label: string;
  platform: string;
  agent_version: string;
  lifecycle_revision: number;
  desired_binding?: string | null;
  last_seen_at_ms: number;
}

export interface HostRecoveryStatus {
  desired_revision: number;
  reconciled_revision: number;
  auto_load_model: boolean;
  auto_prepare_kv: boolean;
  model_ready: boolean;
  cache_ready: boolean;
  model_action: string;
  cache_action: string;
}

export interface HostView extends HostRecord {
  is_connected: boolean;
  lease_valid: boolean;
  current_binding?: PoolBinding | null;
  recovery: HostRecoveryStatus;
  applied_binding_revision: number;
}

export interface WorkerLoadProfile {
  context_tokens: number;
  batch_tokens: number;
  ubatch_tokens: number;
  threads: number;
  gpu_layers: number;
  device_index?: number | null;
  kv_placement: string;
  type_k: string;
  type_v: string;
  flash_attention: boolean;
  swa_full?: boolean;
  n_rs_seq?: number;
}

export interface ExactModelDescriptor {
  artifact_id: string;
  verified_model_sha256: string;
  settings_digest: string;
  profile: WorkerLoadProfile;
}

export interface AppSourceRef {
  tenant_id: string;
  user_id: string;
  workspace_id: string;
  session_id: string;
  scope_hash: string;
  session_hash: string;
  prompt_profile_id: string;
  source_revision: string;
  prefix_digest: string;
  preparation_fingerprint: string;
}

export interface HostRecoveryPreferences {
  host_id: string;
  expected_revision: number;
  reconciled_revision: number;
  auto_load_model: boolean;
  auto_prepare_kv: boolean;
  last_selected_model?: ExactModelDescriptor | null;
  auto_prepare_source?: AppSourceRef | null;
}

export interface ClientUpdateRecoveryPreferences {
  expected_revision: number;
  auto_load_model?: boolean;
  auto_prepare_kv?: boolean;
  auto_prepare_source?: AppSourceRef | null;
}

export type FitVerdictKind =
  | "fits_gpu"
  | "fits_partial_offload"
  | "cpu_only"
  | "does_not_fit"
  | "unknown";

export interface FitVerdictObject {
  verdict: FitVerdictKind;
  reason: string;
  estimated_host_bytes?: number | null;
  estimated_device_bytes?: number | null;
}

export type FitVerdict =
  | FitVerdictKind
  | "fits"
  | "fits_with_warning"
  | FitVerdictObject;

export type TupleQualificationStatus = "qualified" | "unqualified" | "blocked" | "degraded" | "unknown";

export type PerfSource =
  | { type: "receipt_exact_tuple"; receipt_id: string }
  | { type: "observed_turns"; n: number; p50: boolean }
  | { type: "none" }
  | string;

export interface ModelPerfSummary {
  prefill_tps?: number | null;
  decode_tps?: number | null;
  prefill_tokens_per_second?: number | null;
  decode_tokens_per_second?: number | null;
  source: PerfSource;
  measured_at_ms?: number | null;
  is_stale?: boolean;
}

export interface RecommendationRisk {
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface SuggestedProfile {
  rung_name?: string;
  backend: string;
  profile?: WorkerLoadProfile;
  profile_hash?: string;
  device_label?: string | null;
  device_index?: number | null;
  device_fingerprint?: string;
  context_tokens?: number;
  gpu_layers?: number;
  kv_placement?: string;
  flash_attention?: boolean;
}

export interface HostModelRecommendation {
  host_id: string;
  artifact_id: string;
  fit: FitVerdict;
  suggested_profile?: SuggestedProfile | null;
  qualification: TupleQualificationStatus;
  perf: ModelPerfSummary;
  risks: RecommendationRisk[];
  rank?: number | null;
  selectable: boolean;
  disabled_reason?: string | null;
}

export type CacheReadinessStatus =
  | "absent"
  | "partial"
  | "ready"
  | "invalid"
  | "unsupported"
  | "pending_purge";

export interface HostCacheStatus {
  host_id: string;
  scope_key: string;
  session_hash?: string | null;
  status: CacheReadinessStatus;
  committed_tokens?: number | null;
  total_tokens?: number | null;
  last_committed_generation_id?: string | null;
  invalidation_revision: number;
  reason?: string | null;
}

export type CredentialRecoveryStatus =
  | "pending_approval"
  | "approved"
  | "delivered"
  | "acknowledged"
  | "denied"
  | "expired"
  | "revoked";

export interface OperatorRecoveryView {
  request_id: string;
  deployment_id: string;
  installation_id: string;
  host_id: string;
  public_key_fingerprint: string;
  requested_credential_generation: number;
  expiry_ms: number;
  status: CredentialRecoveryStatus;
  approval_revision: number;
  created_at_ms: number;
  approved_at_ms?: number | null;
  delivered_at_ms?: number | null;
  acknowledged_at_ms?: number | null;
}

export interface ApproveRecoveryRequest {
  expected_generation?: number;
  expected_revision?: number;
}

export interface CreateInstallationRequest {
  platform: "ubuntu_x86_64" | "fedora_x86_64" | "windows_x86_64" | string;
  label: string;
}

export interface InstallationDescriptor {
  installation_id: string;
  platform: string;
  label: string;
  script_url: string;
  created_at_ms: number;
}

export interface InstallationStatus {
  installation_id: string;
  platform: string;
  label: string;
  registered_hosts: string[];
  connected_hosts: string[];
  bound_hosts: string[];
  created_at_ms: number;
}

export type OperationKind =
  | "download"
  | "load"
  | "unload"
  | "prepare_kv"
  | "purge"
  | "relocate";

export type OperationState =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "indeterminate";

export interface HostOperationRequest {
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

export interface SanitizedOperationError {
  code: string;
  message?: string;
  sanitized_message?: string;
}
export interface OperationSnapshot {
  operation_id: string;
  host_id: string;
  artifact_id: string;
  mutation_id?: string;
  kind: OperationKind;
  state: OperationState;
  stage?: OperationStage | string;
  revision: number;
  counters: StageCounters;
  stage_counters?: StageCounters | null;
  created_at_ms?: number;
  started_at_ms?: number;
  updated_at_ms?: number;
  completed_at_ms?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  sanitized_error?: SanitizedOperationError | null;
}
