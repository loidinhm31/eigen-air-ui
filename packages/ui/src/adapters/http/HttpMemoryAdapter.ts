import type { IMemoryService } from "../factory/interfaces/IMemoryService.js";
import type {
  EpisodeUpdate,
  EpisodicMemory,
  MemoryEntry,
  MemorySearchResult,
} from "@nonclaw-ui/shared/types";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";

export class HttpMemoryAdapter implements IMemoryService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithAccess(this.baseUrl, path, this.access, init);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<MemoryEntry[]> {
    return this.request("/v1/memory?include_values=true");
  }

  async store(key: string, value: unknown): Promise<void> {
    await this.request("/v1/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  }

  async recall(key: string): Promise<MemoryEntry | null> {
    try {
      return await this.request<MemoryEntry>(`/v1/memory/${encodeURIComponent(key)}`);
    } catch {
      return null;
    }
  }

  search(query: string): Promise<MemorySearchResult[]> {
    return this.request(`/v1/memory/search?q=${encodeURIComponent(query)}`);
  }

  async forget(key: string): Promise<void> {
    await this.request(`/v1/memory/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  listEpisodes(): Promise<EpisodicMemory[]> {
    return this.request("/v1/memory/episodes");
  }

  async getEpisode(id: string): Promise<EpisodicMemory | null> {
    try {
      return await this.request(`/v1/memory/episodes/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }

  updateEpisode(id: string, update: EpisodeUpdate): Promise<EpisodicMemory> {
    return this.request(`/v1/memory/episodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  }

  async deleteEpisode(id: string): Promise<void> {
    await this.request(`/v1/memory/episodes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
