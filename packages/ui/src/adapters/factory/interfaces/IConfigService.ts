import type { HealthStatus, ServerConfig, AgentStatusResponse, ProviderReadinessSnapshot } from "@nonclaw-ui/shared/types";

export interface IConfigService {
  health(): Promise<HealthStatus>;
  getConfig(): Promise<ServerConfig>;
  getStatus(): Promise<AgentStatusResponse>;
  getReadiness(signal?: AbortSignal): Promise<ProviderReadinessSnapshot>;
}
