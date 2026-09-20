import type { IVaultKnowledgeService } from "../factory/interfaces/IVaultKnowledgeService.js";
import type {
  KnowledgeFact,
  KnowledgeRelation,
  VaultItem,
  VaultItemRequest,
} from "@nonclaw-ui/shared/types";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";

export class HttpVaultKnowledgeAdapter implements IVaultKnowledgeService {
  constructor(
    private readonly baseUrl: string,
    private readonly access?: AccessSource
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithAccess(this.baseUrl, path, this.access, init);
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  private json<T>(path: string, body: T): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  listVaultItems(query?: string): Promise<VaultItem[]> {
    const q = query?.trim();
    return this.request(`/v1/vault/items${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  createVaultItem(item: VaultItemRequest): Promise<VaultItem> {
    return this.json("/v1/vault/items", item) as Promise<VaultItem>;
  }

  async getVaultItem(id: string): Promise<VaultItem | null> {
    try {
      return await this.request<VaultItem>(`/v1/vault/items/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }

  deleteVaultItem(id: string): Promise<void> {
    return this.request(`/v1/vault/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listKnowledgeFacts(filters: {
    subject?: string;
    predicate?: string;
    object?: string;
    source_episode_id?: string;
  } = {}): Promise<KnowledgeFact[]> {
    const qs = new URLSearchParams();
    if (filters.subject) qs.set("subject", filters.subject);
    if (filters.predicate) qs.set("predicate", filters.predicate);
    if (filters.object) qs.set("object", filters.object);
    if (filters.source_episode_id) qs.set("source_episode_id", filters.source_episode_id);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request(`/v1/knowledge/facts${suffix}`);
  }

  listKnowledgeRelations(filters: {
    source?: string;
    relation_type?: string;
    target?: string;
  } = {}): Promise<KnowledgeRelation[]> {
    const qs = new URLSearchParams();
    if (filters.source) qs.set("source", filters.source);
    if (filters.relation_type) qs.set("relation_type", filters.relation_type);
    if (filters.target) qs.set("target", filters.target);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request(`/v1/knowledge/relations${suffix}`);
  }

}
