import type {
  IMemoryService,
  MemoryServiceOptions,
} from "../factory/interfaces/IMemoryService.js";
import type {
  EpisodeUpdate,
  EpisodicMemory,
  MemoryEntry,
  MemorySearchResult,
} from "@eigen-air-ui/shared/types";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";
import {
  MemoryHttpError,
  type MemoryHttpErrorKind,
  errorKindForMemoryStatus,
  extractErrorPayload,
} from "./memory-error-helpers.js";

export {
  MemoryHttpError,
  type MemoryHttpErrorKind,
  errorKindForMemoryStatus,
};

export class HttpMemoryAdapter implements IMemoryService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    try {
      const res = await fetchWithAccess(this.baseUrl, path, this.access, init);
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        const { message, code } = extractErrorPayload(raw);
        const kind = errorKindForMemoryStatus(res.status, code);
        throw new MemoryHttpError(
          res.status,
          kind,
          message ?? `Request failed: ${res.status}`,
          code
        );
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (cause) {
      if (cause instanceof MemoryHttpError) {
        throw cause;
      }
      if (
        (cause instanceof DOMException && cause.name === "AbortError") ||
        (cause instanceof Error && cause.name === "AbortError")
      ) {
        throw new MemoryHttpError(0, "aborted", "Memory request was cancelled");
      }
      const msg = cause instanceof Error ? cause.message : "Network communication failed";
      throw new MemoryHttpError(0, "network_error", msg);
    }
  }

  list(options?: MemoryServiceOptions): Promise<MemoryEntry[]> {
    return this.request("/v1/memory?include_values=true", { signal: options?.signal });
  }

  async store(key: string, value: unknown, options?: MemoryServiceOptions): Promise<void> {
    await this.request("/v1/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
      signal: options?.signal,
    });
  }

  async recall(key: string, options?: MemoryServiceOptions): Promise<MemoryEntry | null> {
    try {
      return await this.request<MemoryEntry>(`/v1/memory/${encodeURIComponent(key)}`, {
        signal: options?.signal,
      });
    } catch (err) {
      if (err instanceof MemoryHttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  search(query: string, options?: MemoryServiceOptions): Promise<MemorySearchResult[]> {
    return this.request(`/v1/memory/search?q=${encodeURIComponent(query)}`, {
      signal: options?.signal,
    });
  }

  async forget(key: string, options?: MemoryServiceOptions): Promise<void> {
    await this.request(`/v1/memory/${encodeURIComponent(key)}`, {
      method: "DELETE",
      signal: options?.signal,
    });
  }

  listEpisodes(options?: MemoryServiceOptions): Promise<EpisodicMemory[]> {
    return this.request("/v1/memory/episodes", { signal: options?.signal });
  }

  async getEpisode(id: string, options?: MemoryServiceOptions): Promise<EpisodicMemory | null> {
    try {
      return await this.request<EpisodicMemory>(`/v1/memory/episodes/${encodeURIComponent(id)}`, {
        signal: options?.signal,
      });
    } catch (err) {
      if (err instanceof MemoryHttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  updateEpisode(
    id: string,
    update: EpisodeUpdate,
    options?: MemoryServiceOptions
  ): Promise<EpisodicMemory> {
    return this.request(`/v1/memory/episodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
      signal: options?.signal,
    });
  }

  async deleteEpisode(id: string, options?: MemoryServiceOptions): Promise<void> {
    await this.request(`/v1/memory/episodes/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: options?.signal,
    });
  }
}
