import type { RunListResponseDto, RunSnapshotDto } from "@nonclaw-ui/shared/types";
import {
  fetchWithAccess,
  type AccessContext,
  type AccessSource,
  type RunCapabilities,
} from "./AuthenticatedHttpRequest.js";

const MAX_RUN_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RUN_ERROR_MESSAGE_BYTES = 512;

export type { RunCapabilities };

/** Authenticated host state. It is consumed in memory and never serialized by this adapter. */
export type RunAccessContext = AccessContext;

type RunAccessSource = AccessSource;


function safeRunErrorMessage(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RUN_ERROR_MESSAGE_BYTES ||
    /[\r\n]/.test(value) ||
    /\b(?:answer|auth(?:entication)?[_ ]?token|mutation[_ ]?token|access[_ ]?token)\b/i.test(value) ||
    /\b[a-f0-9]{32,}\b/i.test(value)
  ) {
    return undefined;
  }
  return value;
}

async function readSafeRunErrorMessage(response: Response): Promise<string | undefined> {
  const contentLength = response.headers?.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_RUN_ERROR_MESSAGE_BYTES * 4) return undefined;
  }

  try {
    const body =
      typeof response.text === "function"
        ? JSON.parse(await response.text())
        : await response.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const message = (body as { message?: unknown }).message;
    return safeRunErrorMessage(message);
  } catch {
    return undefined;
  }
}

/** Stateless REST client: callers own the short-lived in-memory result. */
export class HttpRunAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly access: RunAccessSource = {}
  ) {}

  private accessContext(): RunAccessContext {
    return (typeof this.access === "function" ? this.access() : this.access) ?? {};
  }

  private async response(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetchWithAccess(this.baseUrl, path, this.access, init);
    if (!response.ok) {
      const message = await readSafeRunErrorMessage(response);
      const error = new Error(message ?? `Run request failed: ${response.status}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    return response;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.response(path, init);
    // Successful DELETE responses are intentionally empty (204).
    if (response.status === 204) return undefined as T;
    if (response.headers?.get("content-length")) {
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_RUN_RESPONSE_BYTES) {
        throw new Error("Run response exceeds the safe size limit");
      }
    }
    if (typeof response.text === "function") {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RUN_RESPONSE_BYTES) {
        throw new Error("Run response exceeds the safe size limit");
      }
      return JSON.parse(text) as T;
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
    const debug = includeDebug && this.accessContext().capabilities?.has("run:read:debug");
    return this.request(`/v1/runs/${encodeURIComponent(runId)}${debug ? "?include_debug=true" : ""}`, {
      signal,
    });
  }

  async export(runId: string, signal?: AbortSignal): Promise<Blob> {
    if (!this.accessContext().capabilities?.has("run:export")) {
      throw new Error("Run export unavailable");
    }
    const response = await this.response(`/v1/runs/${encodeURIComponent(runId)}/export`, { signal });
    return response.blob();
  }

  async delete(runId: string, signal?: AbortSignal): Promise<void> {
    if (!this.accessContext().capabilities?.has("run:delete")) {
      throw new Error("Run deletion unavailable");
    }
    await this.request<void>(`/v1/runs/${encodeURIComponent(runId)}`, { method: "DELETE", signal });
  }
}
