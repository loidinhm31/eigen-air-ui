import type { IConfigService } from "../factory/interfaces/IConfigService.js";
import type { HealthStatus, ServerConfig, AgentStatusResponse, ProviderReadinessSnapshot } from "@nonclaw-ui/shared/types";
import { fetchWithAccess, type AccessSource, type HttpRequestMode } from "./AuthenticatedHttpRequest.js";

export class HttpConfigAdapter implements IConfigService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(path: string, mode: HttpRequestMode = "protected"): Promise<T> {
    const res = await fetchWithAccess(this.baseUrl, path, this.access, undefined, mode);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<HealthStatus> {
    return this.request("/health", "public");
  }

  getConfig(): Promise<ServerConfig> {
    return this.request("/v1/config");
  }

  getStatus(): Promise<AgentStatusResponse> {
    return this.request("/v1/status");
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

