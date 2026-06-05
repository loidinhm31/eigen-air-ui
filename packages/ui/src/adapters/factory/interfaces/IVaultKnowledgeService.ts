import type {
  KnowledgeFact,
  KnowledgeFactRequest,
  KnowledgeRelation,
  KnowledgeRelationRequest,
  VaultItem,
  VaultItemRequest,
} from "@nonclaw-ui/shared/types";

export interface IVaultKnowledgeService {
  listVaultItems(query?: string): Promise<VaultItem[]>;
  createVaultItem(item: VaultItemRequest): Promise<VaultItem>;
  getVaultItem(id: string): Promise<VaultItem | null>;
  deleteVaultItem(id: string): Promise<void>;
  listKnowledgeFacts(filters?: {
    subject?: string;
    predicate?: string;
    object?: string;
  }): Promise<KnowledgeFact[]>;
  createKnowledgeFact(fact: KnowledgeFactRequest): Promise<KnowledgeFact>;
  listKnowledgeRelations(filters?: {
    source?: string;
    relation_type?: string;
    target?: string;
  }): Promise<KnowledgeRelation[]>;
  createKnowledgeRelation(relation: KnowledgeRelationRequest): Promise<KnowledgeRelation>;
}
