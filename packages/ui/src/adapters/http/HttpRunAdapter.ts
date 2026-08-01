import type { RunListResponseDto, RunSnapshotDto } from "@nonclaw-ui/shared/types";

export type RunCapabilities = ReadonlySet<"run:read:debug" | "run:export" | "run:delete">;

/** Authenticated host state. It is consumed in memory and never serialized by this adapter. */
export interface RunAccessContext {
  capabilities?: RunCapabilities;
  authToken?: string;
  /** Changes when the authenticated principal or role set changes. */
  identityKey?: string;
}

/** Stateless REST client: callers own the short-lived in-memory result. */
export class HttpRunAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly access: RunAccessContext = {}
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(this.access.authToken ? { Authorization: `Bearer ${this.access.authToken}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(
        (body as { message?: string }).message ?? `Run request failed: ${response.status}`
      );
      Object.assign(error, { status: response.status });
      throw error;
    }
    return response.json() as Promise<T>;
  }

  list(cursor?: string, limit = 50, signal?: AbortSignal): Promise<RunListResponseDto> {
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
    if (cursor) params.set("cursor", cursor);
    const query = `?${params.toString()}`;
    return this.request(`/v1/runs${query}`, { signal });
  }

  get(runId: string, includeDebug = false, signal?: AbortSignal): Promise<RunSnapshotDto> {
    // A local UI flag is never authority; default deny until authenticated state injects capability.
    const debug = includeDebug && this.access.capabilities?.has("run:read:debug");
    return this.request(`/v1/runs/${encodeURIComponent(runId)}${debug ? "?include_debug=true" : ""}`, {
      signal,
    });
  }

  async export(runId: string): Promise<Blob> {
    if (!this.access.capabilities?.has("run:export")) {
      throw new Error("Run export unavailable");
    }
    const response = await fetch(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/export`, {
      headers: this.access.authToken ? { Authorization: `Bearer ${this.access.authToken}` } : {},
    });
    if (!response.ok) throw new Error("Run export unavailable");
    return response.blob();
  }

  async delete(runId: string): Promise<void> {
    if (!this.access.capabilities?.has("run:delete")) {
      throw new Error("Run deletion unavailable");
    }
    await this.request(`/v1/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  }
}
