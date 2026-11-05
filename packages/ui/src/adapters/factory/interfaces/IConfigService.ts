import type { HealthStatus, ServerConfig, AgentStatusResponse, ProviderReadinessSnapshot } from "@eigen-air-ui/shared/types";

export interface IConfigService {
  health(signal?: AbortSignal): Promise<HealthStatus>;
  getConfig(signal?: AbortSignal): Promise<ServerConfig>;
  getStatus(signal?: AbortSignal): Promise<AgentStatusResponse>;
  getReadiness(signal?: AbortSignal): Promise<ProviderReadinessSnapshot>;
}
