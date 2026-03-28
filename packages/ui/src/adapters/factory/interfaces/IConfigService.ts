import type { HealthStatus, ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";

export interface IConfigService {
  health(): Promise<HealthStatus>;
  getConfig(): Promise<ServerConfig>;
  getStatus(): Promise<AgentStatusResponse>;
}
