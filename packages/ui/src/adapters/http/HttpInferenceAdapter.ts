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
import {
  decodeApprovePairingResponse,
  decodeCanonicalOperationSnapshot,
  decodeHostCacheStatus,
  decodeHostModelRecommendation,
  decodeHostRecoveryPreferences,
  decodeHostView,
  decodeInstallationDescriptor,
  decodeInstallationStatus,
  decodeModelInventoryItem,
  decodeOperationSnapshot,
  decodeOperatorRecoveryView,
  decodePoolBinding,
  decodePoolSummary,
  decodePublicDeviceSummary,
  decodeStorageRootDescriptor,
  decodeStorageSelectionResponse,
} from "@eigen-air-ui/shared/types";
import type {
  DownloadAttachmentResult,
  IInferenceService,
} from "../factory/interfaces/IInferenceService.js";

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

    const data = (await res.json()) as T;

    if (startRevision !== undefined) {
      const postBodyRevision = this.getAccessRevision();
      if (postBodyRevision !== undefined && postBodyRevision !== startRevision) {
        throw new InferenceHttpError(
          0,
          "aborted",
          "Inference request discarded due to credential or principal rotation during body consumption"
        );
      }
    }

    return data;
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


  async listServerRoots(): Promise<StorageRootDescriptor[]> {
    const raw = await this.request<unknown[]>("/v1/inference/server/roots");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeStorageRootDescriptor);
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

  // --- Phase 12 Managed Gateway & Host Implementations ---

  async downloadInstallationScript(
    installationId: string,
    maxBytes = 1024 * 1024
  ): Promise<DownloadAttachmentResult> {
    const startRevision = this.getAccessRevision();
    const res = await fetchWithAccess(
      this.baseUrl,
      `/v1/inference/installations/${encodeURIComponent(installationId)}/script`,
      this.access,
      { cache: "no-store" },
      "protected"
    );

    // Fence check after response headers
    if (startRevision !== undefined) {
      const headerRevision = this.getAccessRevision();
      if (headerRevision !== undefined && headerRevision !== startRevision) {
        throw new InferenceHttpError(
          0,
          "aborted",
          "Script download aborted due to credential or principal rotation"
        );
      }
    }

    if (!res.ok) {
      const raw = await res.json().catch(() => ({}));
      const code = typeof raw?.error === "string" ? raw.error : "download_failed";
      const message = typeof raw?.message === "string" ? raw.message : `HTTP ${res.status}`;
      throw new InferenceHttpError(res.status, code, message);
    }

    // Extract sanitized filename from Content-Disposition header
    const disposition = res.headers.get("content-disposition") || "";
    let safeFilename = `install-${installationId}.sh`;
    const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    if (filenameMatch && filenameMatch[1]) {
      const candidate = decodeURIComponent(filenameMatch[1].trim());
      const sanitized = candidate.replace(/[/\\?%*:|"<>]/g, "").trim();
      if (sanitized && !sanitized.startsWith(".")) {
        safeFilename = sanitized;
      }
    }

    // Read body with byte bounding during streaming
    if (!res.body) {
      throw new InferenceHttpError(0, "empty_response", "Script download returned no body");
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new InferenceHttpError(
              0,
              "payload_too_large",
              `Script size exceeded limit of ${maxBytes} bytes`
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Fence check after body consumption
    if (startRevision !== undefined) {
      const postBodyRevision = this.getAccessRevision();
      if (postBodyRevision !== undefined && postBodyRevision !== startRevision) {
        throw new InferenceHttpError(
          0,
          "aborted",
          "Script download discarded due to credential or principal rotation during body streaming"
        );
      }
    }

    const contentType = res.headers.get("content-type") || "text/plain";
    const blob = new Blob(chunks as BlobPart[], { type: contentType });

    return {
      blob,
      filename: safeFilename,
      sizeBytes: totalBytes,
    };
  }

  async createInstallation(req: CreateInstallationRequest): Promise<InstallationDescriptor> {
    const raw = await this.request<unknown>("/v1/inference/installations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return decodeInstallationDescriptor(raw);
  }

  async getInstallation(installationId: string): Promise<InstallationStatus> {
    const raw = await this.request<unknown>(
      `/v1/inference/installations/${encodeURIComponent(installationId)}`
    );
    return decodeInstallationStatus(raw);
  }

  async listHosts(): Promise<HostView[]> {
    const raw = await this.request<unknown>("/v1/inference/hosts");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeHostView);
  }

  async getHost(hostId: string): Promise<HostView> {
    const raw = await this.request<unknown>(`/v1/inference/hosts/${encodeURIComponent(hostId)}`);
    return decodeHostView(raw);
  }

  async mutateBinding(hostId: string, mutation: PoolBindingMutation): Promise<PoolBinding> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/binding`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      }
    );
    return decodePoolBinding(raw);
  }

  async unbindHost(
    hostId: string,
    expectedRevision?: number
  ): Promise<{ status: string; revision: number }> {
    const mutationId = `${Date.now()}-${crypto.randomUUID()}`;
    const headers: Record<string, string> = {
      "x-mutation-id": mutationId,
    };
    if (expectedRevision !== undefined) {
      headers["If-Match"] = `"${expectedRevision}"`;
    }
    const query = new URLSearchParams({
      mutation_id: mutationId,
      ...(expectedRevision !== undefined ? { expected_revision: String(expectedRevision) } : {}),
    });
    const raw = await this.request<{ status?: string; revision?: number }>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/binding?${query.toString()}`,
      {
        method: "DELETE",
        headers,
      }
    );
    return {
      status: typeof raw?.status === "string" ? raw.status : "draining",
      revision: typeof raw?.revision === "number" ? raw.revision : 0,
    };
  }

  async listPools(): Promise<PoolSummary[]> {
    const raw = await this.request<unknown>("/v1/inference/pools");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodePoolSummary);
  }

  async getPool(poolId: string): Promise<PoolRecord> {
    const raw = await this.request<{
      pool_id: string;
      name?: string;
      description?: string;
      revision?: number;
      created_at_ms?: number;
    }>(`/v1/inference/pools/${encodeURIComponent(poolId)}`);
    return {
      pool_id: raw.pool_id,
      name: raw.name || raw.pool_id,
      description: raw.description || "",
      revision: raw.revision || 0,
      created_at_ms: raw.created_at_ms || 0,
    };
  }

  async listHostModels(hostId: string): Promise<HostModelRecommendation[]> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/models`
    );
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeHostModelRecommendation);
  }

  async dispatchModelOperation(
    hostId: string,
    artifactId: string,
    req: HostOperationRequest
  ): Promise<{ operation_id: string; status: string }> {
    const raw = await this.request<{ operation_id: string; status: string }>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/models/${encodeURIComponent(artifactId)}/operations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      }
    );
    return {
      operation_id: typeof raw?.operation_id === "string" ? raw.operation_id : "",
      status: typeof raw?.status === "string" ? raw.status : "queued",
    };
  }

  async listHostOperations(hostId: string): Promise<OperationSnapshot[]> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/operations`
    );
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeOperationSnapshot);
  }

  async dispatchHostOperation(
    hostId: string,
    req: HostOperationRequest
  ): Promise<{ operation_id: string; status: string }> {
    const raw = await this.request<{ operation_id: string; status: string }>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/operations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: req }),
      }
    );
    return {
      operation_id: typeof raw?.operation_id === "string" ? raw.operation_id : "",
      status: typeof raw?.status === "string" ? raw.status : "queued",
    };
  }

  async getOperation(operationId: string): Promise<OperationSnapshot> {
    const raw = await this.request<unknown>(
      `/v1/inference/operations/${encodeURIComponent(operationId)}`
    );
    return decodeOperationSnapshot(raw);
  }

  async cancelOperation(operationId: string): Promise<OperationSnapshot | void> {
    const raw = await this.request<unknown>(
      `/v1/inference/operations/${encodeURIComponent(operationId)}/cancel`,
      {
        method: "POST",
      }
    );
    if (raw && typeof raw === "object" && "operation_id" in raw) {
      return decodeOperationSnapshot(raw);
    }
  }

  async purgeHostCache(
    hostId: string,
    payload: { session_id?: string; mutation_id?: string } = {}
  ): Promise<{ status: string; operation_id?: string }> {
    const mutationId = payload.mutation_id || `${Date.now()}-${crypto.randomUUID()}`;
    const raw = await this.request<{ status?: string; operation_id?: string }>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/cache/purge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: payload.session_id || "default",
          mutation_id: mutationId,
        }),
      }
    );
    return {
      status: typeof raw?.status === "string" ? raw.status : "pending_purge",
      operation_id: typeof raw?.operation_id === "string" ? raw.operation_id : undefined,
    };
  }

  async getHostCacheStatus(hostId: string): Promise<HostCacheStatus[]> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/cache/status`
    );
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeHostCacheStatus);
  }

  async getRecoveryPreferences(hostId: string): Promise<HostRecoveryPreferences> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/preferences`
    );
    return decodeHostRecoveryPreferences(raw);
  }

  async saveRecoveryPreferences(
    hostId: string,
    prefs: ClientUpdateRecoveryPreferences
  ): Promise<HostRecoveryPreferences> {
    const raw = await this.request<unknown>(
      `/v1/inference/hosts/${encodeURIComponent(hostId)}/recovery-preferences`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }
    );
    return decodeHostRecoveryPreferences(raw);
  }

  async listCredentialRecoveries(): Promise<OperatorRecoveryView[]> {
    const raw = await this.request<unknown>("/v1/inference/credential-recoveries");
    if (!Array.isArray(raw)) return [];
    return raw.map(decodeOperatorRecoveryView);
  }

  async approveCredentialRecovery(
    requestId: string,
    body: ApproveRecoveryRequest = {}
  ): Promise<OperatorRecoveryView> {
    const raw = await this.request<unknown>(
      `/v1/inference/credential-recoveries/${encodeURIComponent(requestId)}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return decodeOperatorRecoveryView(raw);
  }

  async denyCredentialRecovery(
    requestId: string,
    expectedRevision?: number
  ): Promise<OperatorRecoveryView> {
    const raw = await this.request<unknown>(
      `/v1/inference/credential-recoveries/${encodeURIComponent(requestId)}/deny`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: expectedRevision }),
      }
    );
    return decodeOperatorRecoveryView(raw);
  }
}
