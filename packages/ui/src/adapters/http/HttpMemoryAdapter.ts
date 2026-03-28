import type { IMemoryService } from "../factory/interfaces/IMemoryService.js";
import type { MemoryEntry, MemorySearchResult } from "@nonclaw-ui/shared/types";

export class HttpMemoryAdapter implements IMemoryService {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<string[]> {
    return this.request("/v1/memory");
  }

  async store(key: string, value: string): Promise<void> {
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
}
