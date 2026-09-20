export type ReadinessStageStatus = "pending" | "running" | "completed" | "skipped" | "failed";

export interface ReadinessStageInfo {
  name: string;
  status: ReadinessStageStatus;
  elapsed_ms?: number;
  reason?: string;
}

export interface ReadinessDetails {
  stages: ReadinessStageInfo[];
}

export type ReadinessState = "starting" | "ready" | "degraded_cpu" | "failed";

export interface ProviderReadinessSnapshot {
  status: ReadinessState;
  retryable: boolean;
  details: ReadinessDetails;
}
