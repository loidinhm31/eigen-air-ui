import type {
  ApprovePairingResponse,
  ApproveRecoveryRequest,
  CanonicalOperationSnapshot,
  ClientUpdateRecoveryPreferences,
  CreateInstallationRequest,
  DeviceRetirementOptions,
  HostCacheStatus,
  HostModelRecommendation,
  HostOperationRequest,
  HostRecoveryPreferences,
  HostView,
  InstallationDescriptor,
  InstallationStatus,
  ModelInventoryItem,
  OperationSnapshot,
  OperatorRecoveryView,
  PoolBinding,
  PoolBindingMutation,
  PoolRecord,
  PoolSummary,
  PublicDeviceSummary,
  StorageRootDescriptor,
  StorageRootKind,
  StorageSelectionResponse,
} from "@eigen-air-ui/shared/types";

export interface DownloadAttachmentResult {
  blob: Blob;
  filename: string;
  sizeBytes: number;
}
export interface IInferenceService {
  listServerModels(): Promise<ModelInventoryItem[]>;
  getServerModel(artifactId: string): Promise<ModelInventoryItem>;
  downloadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot>;
  importServerModel(artifactId: string, sourcePath: string): Promise<CanonicalOperationSnapshot>;
  deleteServerModel(artifactId: string): Promise<{ status: string; artifact_id: string }>;
  loadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot>;
  unloadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot>;
  prepareServerModelCache(artifactId: string, prompt?: string): Promise<CanonicalOperationSnapshot>;
  rebuildServerModelCache(artifactId: string, prompt?: string): Promise<CanonicalOperationSnapshot>;
  purgeServerModelCache(artifactId: string): Promise<{ purged_count: number; artifact_id: string }>;

  listServerRoots(): Promise<StorageRootDescriptor[]>;
  selectServerRoot(rootId: string, expectedRevision?: number): Promise<{ selected_root_id: string; revision: number }>;

  getServerOperation(operationId: string): Promise<CanonicalOperationSnapshot>;
  cancelServerOperation(operationId: string): Promise<CanonicalOperationSnapshot>;

  listDevices(): Promise<PublicDeviceSummary[]>;
  getDevice(deviceId: string): Promise<PublicDeviceSummary>;
  revokeDevice(deviceId: string): Promise<PublicDeviceSummary>;
  retireDevice(deviceId: string, options?: DeviceRetirementOptions): Promise<PublicDeviceSummary>;
  approvePairing(pairingId: string, code: string): Promise<ApprovePairingResponse>;
  requestDeviceStorageSelection(deviceId: string, kind?: StorageRootKind, label?: string): Promise<StorageSelectionResponse>;
  getDeviceStorageSelection(deviceId: string, requestId: string): Promise<StorageSelectionResponse>;

  // --- Phase 12 Managed Gateway & Host APIs ---
  createInstallation(req: CreateInstallationRequest): Promise<InstallationDescriptor>;
  getInstallation(installationId: string): Promise<InstallationStatus>;
  downloadInstallationScript(installationId: string, maxBytes?: number): Promise<DownloadAttachmentResult>;

  listHosts(): Promise<HostView[]>;
  getHost(hostId: string): Promise<HostView>;

  mutateBinding(hostId: string, mutation: PoolBindingMutation): Promise<PoolBinding>;
  unbindHost(hostId: string, expectedRevision?: number): Promise<{ status: string; revision: number }>;

  listPools(): Promise<PoolSummary[]>;
  getPool(poolId: string): Promise<PoolRecord>;

  listHostModels(hostId: string): Promise<HostModelRecommendation[]>;
  dispatchModelOperation(
    hostId: string,
    artifactId: string,
    req: HostOperationRequest
  ): Promise<{ operation_id: string; status: string }>;

  listHostOperations(hostId: string): Promise<OperationSnapshot[]>;
  dispatchHostOperation(
    hostId: string,
    req: HostOperationRequest
  ): Promise<{ operation_id: string; status: string }>;
  getOperation(operationId: string): Promise<OperationSnapshot>;
  cancelOperation(operationId: string): Promise<OperationSnapshot | void>;
  purgeHostCache(
    hostId: string,
    payload?: { session_id?: string; mutation_id?: string }
  ): Promise<{ status: string; operation_id?: string }>;
  getHostCacheStatus(hostId: string): Promise<HostCacheStatus[]>;

  getRecoveryPreferences(hostId: string): Promise<HostRecoveryPreferences>;
  saveRecoveryPreferences(
    hostId: string,
    prefs: ClientUpdateRecoveryPreferences
  ): Promise<HostRecoveryPreferences>;

  listCredentialRecoveries(): Promise<OperatorRecoveryView[]>;
  approveCredentialRecovery(
    requestId: string,
    body?: ApproveRecoveryRequest
  ): Promise<OperatorRecoveryView>;
  denyCredentialRecovery(
    requestId: string,
    expectedRevision?: number
  ): Promise<OperatorRecoveryView>;
}
