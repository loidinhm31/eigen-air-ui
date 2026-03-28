import type { IConfigService } from "../factory/interfaces/IConfigService.js";
import type { HealthStatus, ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";

export class HttpConfigAdapter implements IConfigService {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<HealthStatus> {
    return this.request("/health");
  }

  getConfig(): Promise<ServerConfig> {
    return this.request("/v1/config");
  }

  getStatus(): Promise<AgentStatusResponse> {
    return this.request("/v1/agents/default");
  }
}
