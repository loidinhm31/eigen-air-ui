import * as React from "react";
import { useEffect, useState } from "react";
import { getVaultKnowledgeService } from "../../adapters/factory/ServiceFactory.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import type { KnowledgeFact, KnowledgeRelation, VaultItem } from "@nonclaw-ui/shared/types";

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function VaultKnowledgeSection() {
  const [vaultQuery, setVaultQuery] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [vaultContent, setVaultContent] = useState("");
  const [factSubject, setFactSubject] = useState("");
  const [factPredicate, setFactPredicate] = useState("");
  const [factObject, setFactObject] = useState("");
  const [relationSource, setRelationSource] = useState("");
  const [relationType, setRelationType] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [facts, setFacts] = useState<KnowledgeFact[]>([]);
  const [relations, setRelations] = useState<KnowledgeRelation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = React.useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const service = getVaultKnowledgeService();
      const [items, loadedFacts, loadedRelations] = await Promise.all([
        service.listVaultItems(query),
        service.listKnowledgeFacts(),
        service.listKnowledgeRelations(),
      ]);
      setVaultItems(items);
      setFacts(loadedFacts);
      setRelations(loadedRelations);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  async function createVaultItem() {
    if (!vaultName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      let content: unknown = vaultContent.trim();
      if (vaultContent.trim().startsWith("{") || vaultContent.trim().startsWith("[")) {
        content = JSON.parse(vaultContent);
      }
      await getVaultKnowledgeService().createVaultItem({
        name: vaultName.trim(),
        content,
        media_type: "application/json",
      });
      setVaultName("");
      setVaultContent("");
      await loadAll(vaultQuery);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  async function createFact() {
    if (!factSubject.trim() || !factPredicate.trim() || !factObject.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await getVaultKnowledgeService().createKnowledgeFact({
        subject: factSubject.trim(),
        predicate: factPredicate.trim(),
        object: factObject.trim(),
      });
      setFactSubject("");
      setFactPredicate("");
      setFactObject("");
      await loadAll(vaultQuery);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  async function createRelation() {
    if (!relationSource.trim() || !relationType.trim() || !relationTarget.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await getVaultKnowledgeService().createKnowledgeRelation({
        source: relationSource.trim(),
        relation_type: relationType.trim(),
        target: relationTarget.trim(),
      });
      setRelationSource("");
      setRelationType("");
      setRelationTarget("");
      await loadAll(vaultQuery);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  async function deleteVaultItem(id: string) {
    setLoading(true);
    setError(null);
    try {
      await getVaultKnowledgeService().deleteVaultItem(id);
      await loadAll(vaultQuery);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll("");
  }, [loadAll]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Vault & knowledge</p>
        <Button variant="outline" size="sm" onClick={() => void loadAll(vaultQuery)} disabled={loading}>
          Refresh
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="grid gap-2 lg:grid-cols-3">
        <Input value={vaultName} onChange={(e) => setVaultName(e.target.value)} placeholder="Vault item name" />
        <Input value={vaultContent} onChange={(e) => setVaultContent(e.target.value)} placeholder="Vault content or JSON" />
        <Button onClick={() => void createVaultItem()} disabled={loading || !vaultName.trim()}>
          Add vault item
        </Button>
      </div>
      <div className="grid gap-2 lg:grid-cols-4">
        <Input value={factSubject} onChange={(e) => setFactSubject(e.target.value)} placeholder="Subject" />
        <Input value={factPredicate} onChange={(e) => setFactPredicate(e.target.value)} placeholder="Predicate" />
        <Input value={factObject} onChange={(e) => setFactObject(e.target.value)} placeholder="Object" />
        <Button onClick={() => void createFact()} disabled={loading}>Add fact</Button>
      </div>
      <div className="grid gap-2 lg:grid-cols-4">
        <Input value={relationSource} onChange={(e) => setRelationSource(e.target.value)} placeholder="Source" />
        <Input value={relationType} onChange={(e) => setRelationType(e.target.value)} placeholder="Relation type" />
        <Input value={relationTarget} onChange={(e) => setRelationTarget(e.target.value)} placeholder="Target" />
        <Button onClick={() => void createRelation()} disabled={loading}>Add relation</Button>
      </div>
      <div className="flex gap-2">
        <Input value={vaultQuery} onChange={(e) => setVaultQuery(e.target.value)} placeholder="Filter vault items" />
        <Button variant="outline" onClick={() => void loadAll(vaultQuery)} disabled={loading}>Filter</Button>
      </div>
      <div className="grid min-h-0 gap-3 overflow-auto text-xs lg:grid-cols-3">
        <div className="space-y-1">
          <p className="font-medium">Vault items ({vaultItems.length})</p>
          {vaultItems.map((item) => (
            <div key={item.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{item.name}</p>
                <Button variant="ghost" size="sm" onClick={() => void deleteVaultItem(item.id)}>Delete</Button>
              </div>
              <p className="truncate text-muted-foreground">{item.media_type}</p>
              <p className="break-words text-muted-foreground">{compactJson(item.content)}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <p className="font-medium">Facts ({facts.length})</p>
          {facts.map((fact) => (
            <p key={fact.id} className="rounded-md border border-border p-2">
              {fact.subject} {fact.predicate} {fact.object}
            </p>
          ))}
        </div>
        <div className="space-y-1">
          <p className="font-medium">Relations ({relations.length})</p>
          {relations.map((relation) => (
            <p key={relation.id} className="rounded-md border border-border p-2">
              {relation.source} {relation.relation_type} {relation.target}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
VaultKnowledgeSection.displayName = "VaultKnowledgeSection";
