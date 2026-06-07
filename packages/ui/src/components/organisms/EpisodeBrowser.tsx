import * as React from "react";
import { useEffect, useState } from "react";
import { getMemoryService, getVaultKnowledgeService } from "../../adapters/factory/ServiceFactory.js";
import { Button } from "../atoms/Button.js";
import { useMemoryStore } from "../../stores/memoryStore.js";
import type { EpisodicMemory, KnowledgeFact } from "@nonclaw-ui/shared/types";

interface EpisodeCardProps {
  episode: EpisodicMemory;
  onChanged: () => Promise<void>;
}

function EpisodeCard({ episode, onChanged }: EpisodeCardProps) {
  const [input, setInput] = useState(episode.input);
  const [output, setOutput] = useState(episode.output);
  const [summary, setSummary] = useState(episode.summary);
  const [facts, setFacts] = useState<KnowledgeFact[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFacts = React.useCallback(async () => {
    setFacts(await getVaultKnowledgeService().listKnowledgeFacts({ source_episode_id: episode.id }));
  }, [episode.id]);

  useEffect(() => {
    void loadFacts();
  }, [loadFacts]);

  async function saveTranscript() {
    setError(null);
    try {
      const updated = await getMemoryService().updateEpisode(episode.id, { input, output });
      setSummary(updated.summary);
      await loadFacts();
      await onChanged();
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function saveSummary() {
    setError(null);
    try {
      await getMemoryService().updateEpisode(episode.id, { summary });
      await onChanged();
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function remove() {
    if (!window.confirm("Delete this episode and all linked facts?")) return;
    await getMemoryService().deleteEpisode(episode.id);
    await onChanged();
  }

  return (
    <article className="space-y-3 rounded-md border border-border bg-card p-3" data-testid={`episode-${episode.id}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-mono text-muted-foreground">{episode.id}</p>
        <Button variant="destructive" size="sm" onClick={() => void remove()}>Delete episode</Button>
      </div>
      <label className="block text-xs font-medium">User transcript
        <textarea aria-label={`Episode ${episode.id} input`} className="mt-1 min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm" value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      <label className="block text-xs font-medium">Assistant transcript
        <textarea aria-label={`Episode ${episode.id} output`} className="mt-1 min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm" value={output} onChange={(event) => setOutput(event.target.value)} />
      </label>
      <Button size="sm" onClick={() => void saveTranscript()}>Save transcript</Button>
      <label className="block text-xs font-medium">Generated summary
        <textarea aria-label={`Episode ${episode.id} summary`} className="mt-1 min-h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm" value={summary} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <Button variant="outline" size="sm" onClick={() => void saveSummary()}>Save summary only</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div>
        <p className="text-xs font-medium">Derived facts ({facts.length})</p>
        {facts.map((fact) => <p key={fact.id} className="mt-1 rounded border border-border p-2 text-xs">{fact.subject} {fact.predicate} {fact.object}</p>)}
        {facts.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No deterministic facts found. Try phrases such as “I prefer Rust”, a URL, date, or decision.
          </p>
        )}
      </div>
    </article>
  );
}

export function EpisodeBrowser() {
  const [episodes, setEpisodes] = useState<EpisodicMemory[]>([]);
  const revision = useMemoryStore((state) => state.revision);
  const load = React.useCallback(async () => setEpisodes(await getMemoryService().listEpisodes()), []);
  useEffect(() => { void load(); }, [load, revision]);
  return (
    <section className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Episodes</h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
      </div>
      {episodes.map((episode) => <EpisodeCard key={episode.id} episode={episode} onChanged={load} />)}
      {episodes.length === 0 && <p className="text-sm text-muted-foreground">No episodes yet</p>}
    </section>
  );
}
EpisodeBrowser.displayName = "EpisodeBrowser";
