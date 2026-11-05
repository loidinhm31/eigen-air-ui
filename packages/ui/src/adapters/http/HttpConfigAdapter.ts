import type { IConfigService } from "../factory/interfaces/IConfigService.js";
import type { HealthStatus, ServerConfig, AgentStatusResponse, ProviderReadinessSnapshot } from "@eigen-air-ui/shared/types";
import { fetchWithAccess, type AccessSource, type HttpRequestMode } from "./AuthenticatedHttpRequest.js";

export class HttpConfigAdapter implements IConfigService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(
    path: string,
    mode: HttpRequestMode = "protected",
    signal?: AbortSignal
  ): Promise<T> {
    const res = await fetchWithAccess(
      this.baseUrl,
      path,
      this.access,
      signal ? { signal } : undefined,
      mode
    );
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      const msg =
        err && typeof err === "object" && "message" in err && typeof err.message === "string"
          ? err.message
          : undefined;
      throw new Error(msg ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  health(signal?: AbortSignal): Promise<HealthStatus> {
    return this.request("/health", "public", signal);
  }

  getConfig(signal?: AbortSignal): Promise<ServerConfig> {
    return this.request("/v1/config", "protected", signal);
  }

  getStatus(signal?: AbortSignal): Promise<AgentStatusResponse> {
    return this.request("/v1/status", "protected", signal);
  }

  async getReadiness(signal?: AbortSignal): Promise<ProviderReadinessSnapshot> {
    const res = await fetchWithAccess(
      this.baseUrl,
      "/readyz",
      this.access,
      { cache: "no-store", signal },
      "public"
    );
    if (res.status !== 200 && res.status !== 503) {
      const err = await res.json().catch(() => null);
      const msg = err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : undefined;
      throw new Error(msg ?? `Readiness check failed: ${res.status}`);
    }
    return (await res.json()) as ProviderReadinessSnapshot;
  }
}

