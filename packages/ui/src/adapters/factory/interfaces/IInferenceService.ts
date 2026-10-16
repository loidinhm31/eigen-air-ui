import type {
  ApprovePairingResponse,
  CanonicalOperationSnapshot,
  DeviceRetirementOptions,
  ModelInventoryItem,
  PublicDeviceSummary,
  StorageRootDescriptor,
  StorageRootKind,
  StorageSelectionResponse,
} from "@eigen-air-ui/shared/types";

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
}
