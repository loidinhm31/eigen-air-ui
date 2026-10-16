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
import {
  decodeApprovePairingResponse,
  decodeCanonicalOperationSnapshot,
  decodeModelInventoryItem,
  decodePublicDeviceSummary,
  decodeStorageRootDescriptor,
  decodeStorageSelectionResponse,
} from "@eigen-air-ui/shared/types";
import type { IInferenceService } from "../factory/interfaces/IInferenceService.js";
import {
  fetchWithAccess,
  type AccessSource,
  type HttpRequestMode,
} from "./AuthenticatedHttpRequest.js";

export class InferenceHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "InferenceHttpError";
  }
}

export class HttpInferenceAdapter implements IInferenceService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private getAccessRevision(): number | undefined {
    const current = typeof this.access === "function" ? this.access() : this.access;
    return current?.accessRevision;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    mode: HttpRequestMode = "protected"
  ): Promise<T> {
    const startRevision = this.getAccessRevision();
    const res = await fetchWithAccess(this.baseUrl, path, this.access, init, mode);

    if (startRevision !== undefined) {
      const currentRevision = this.getAccessRevision();
      if (currentRevision !== undefined && currentRevision !== startRevision) {
        throw new InferenceHttpError(
          0,
          "aborted",
          "Inference request discarded due to credential or principal rotation"
        );
      }
    }

    if (!res.ok) {
      const raw = await res.json().catch(() => ({}));
      const code = typeof raw?.error === "string" ? raw.error : "request_failed";
      const message = typeof raw?.message === "string" ? raw.message : `HTTP ${res.status}`;
      throw new InferenceHttpError(res.status, code, message);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async listServerModels(): Promise<ModelInventoryItem[]> {
    const raw = await this.request<unknown[]>("/v1/inference/server/models");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeModelInventoryItem);
  }

  async getServerModel(artifactId: string): Promise<ModelInventoryItem> {
    const raw = await this.request<unknown>(`/v1/inference/server/models/${encodeURIComponent(artifactId)}`);
    return decodeModelInventoryItem(raw);
  }

  async downloadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>("/v1/inference/server/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact_id: artifactId }),
    });
    return decodeCanonicalOperationSnapshot(raw);
  }

  async importServerModel(artifactId: string, sourcePath: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>("/v1/inference/server/models/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact_id: artifactId, source_path: sourcePath }),
    });
    return decodeCanonicalOperationSnapshot(raw);
  }

  async deleteServerModel(artifactId: string): Promise<{ status: string; artifact_id: string }> {
    return this.request<{ status: string; artifact_id: string }>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}`,
      { method: "DELETE" }
    );
  }

  async loadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}/load`,
      { method: "POST" }
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async unloadServerModel(artifactId: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}/unload`,
      { method: "POST" }
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async prepareServerModelCache(artifactId: string, prompt?: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}/cache/prepare`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async rebuildServerModelCache(artifactId: string, prompt?: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}/cache/rebuild`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      }
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async purgeServerModelCache(artifactId: string): Promise<{ purged_count: number; artifact_id: string }> {
    return this.request<{ purged_count: number; artifact_id: string }>(
      `/v1/inference/server/models/${encodeURIComponent(artifactId)}/cache`,
      { method: "DELETE" }
    );
  }

  async listServerRoots(): Promise<StorageRootDescriptor[]> {
    const raw = await this.request<unknown[]>("/v1/inference/server/roots");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeStorageRootDescriptor);
  }

  async selectServerRoot(
    rootId: string,
    expectedRevision?: number
  ): Promise<{ selected_root_id: string; revision: number }> {
    return this.request<{ selected_root_id: string; revision: number }>(
      "/v1/inference/server/roots/select",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root_id: rootId,
          expected_revision: expectedRevision,
        }),
      }
    );
  }

  async getServerOperation(operationId: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/operations/${encodeURIComponent(operationId)}`
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async cancelServerOperation(operationId: string): Promise<CanonicalOperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/server/operations/${encodeURIComponent(operationId)}/cancel`,
      { method: "POST" }
    );
    return decodeCanonicalOperationSnapshot(raw);
  }

  async listDevices(): Promise<PublicDeviceSummary[]> {
    const raw = await this.request<unknown[]>("/v1/inference/devices");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodePublicDeviceSummary);
  }

  async getDevice(deviceId: string): Promise<PublicDeviceSummary> {
    const raw = await this.request<unknown>(`/v1/inference/devices/${encodeURIComponent(deviceId)}`);
    return decodePublicDeviceSummary(raw);
  }

  async revokeDevice(deviceId: string): Promise<PublicDeviceSummary> {
    const raw = await this.request<unknown>(
      `/v1/inference/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" }
    );
    return decodePublicDeviceSummary(raw);
  }

  async retireDevice(
    deviceId: string,
    options?: DeviceRetirementOptions
  ): Promise<PublicDeviceSummary> {
    const raw = await this.request<unknown>(
      `/v1/inference/devices/${encodeURIComponent(deviceId)}/retire`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? { archive_warning: true }),
      }
    );
    return decodePublicDeviceSummary(raw);
  }

  async approvePairing(pairingId: string, code: string): Promise<ApprovePairingResponse> {
    const raw = await this.request<unknown>(
      `/v1/inference/pairings/${encodeURIComponent(pairingId)}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, confirmed: true }),
      }
    );
    return decodeApprovePairingResponse(raw);
  }

  async requestDeviceStorageSelection(
    deviceId: string,
    kind: StorageRootKind = "model_root",
    label?: string
  ): Promise<StorageSelectionResponse> {
    const raw = await this.request<unknown>(
      `/v1/inference/devices/${encodeURIComponent(deviceId)}/storage-selection`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label }),
      }
    );
    return decodeStorageSelectionResponse(raw);
  }

  async getDeviceStorageSelection(
    deviceId: string,
    requestId: string
  ): Promise<StorageSelectionResponse> {
    const raw = await this.request<unknown>(
      `/v1/inference/devices/${encodeURIComponent(deviceId)}/storage-selection/${encodeURIComponent(requestId)}`
    );
    return decodeStorageSelectionResponse(raw);
  }
}
