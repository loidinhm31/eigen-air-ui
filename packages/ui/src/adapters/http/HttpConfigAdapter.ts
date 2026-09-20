import type { IConfigService } from "../factory/interfaces/IConfigService.js";
import type { HealthStatus, ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";
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
    return this.request("/v1/agents/default");
  }
}

