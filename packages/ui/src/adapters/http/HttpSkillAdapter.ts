import type { ISkillService } from "../factory/interfaces/ISkillService.js";
import type { Skill, SkillSearchResult } from "@nonclaw-ui/shared/types";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";

export class HttpSkillAdapter implements ISkillService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(path: string): Promise<T> {
    const res = await fetchWithAccess(this.baseUrl, path, this.access);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<Skill[]> {
    return this.request("/v1/skills");
  }

  search(query: string): Promise<SkillSearchResult[]> {
    return this.request(`/v1/skills/search?q=${encodeURIComponent(query)}`);
  }
}
