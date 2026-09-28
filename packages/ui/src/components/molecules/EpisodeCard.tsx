import * as React from "react";
import { useEffect, useState } from "react";
import { getMemoryService, getVaultKnowledgeService } from "../../adapters/factory/ServiceFactory.js";
import { Button } from "../atoms/Button.js";
import type { EpisodicMemory, KnowledgeFact } from "@eigen-air-ui/shared/types";

export interface EpisodeCardProps {
  episode: EpisodicMemory;
  isFocused?: boolean;
  onChanged: () => Promise<void>;
}

export function EpisodeCard({ episode, isFocused = false, onChanged }: EpisodeCardProps) {
  const [input, setInput] = useState(episode.input);
  const [output, setOutput] = useState(episode.output);
  const [summary, setSummary] = useState(episode.summary);
  const [facts, setFacts] = useState<KnowledgeFact[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(episode.input);
    setOutput(episode.output);
    setSummary(episode.summary);
  }, [episode.input, episode.output, episode.summary]);

  const loadFacts = React.useCallback(async () => {
    try {
      setFacts(await getVaultKnowledgeService().listKnowledgeFacts({ source_episode_id: episode.id }));
    } catch {
      // Fact loading failure does not break episode card view
    }
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
      const msg = cause instanceof Error ? cause.message : String(cause);
      setError(msg);
    }
  }

  async function saveSummary() {
    setError(null);
    try {
      await getMemoryService().updateEpisode(episode.id, { summary });
      await onChanged();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setError(msg);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this episode and all linked facts?")) return;
    try {
      await getMemoryService().deleteEpisode(episode.id);
      await onChanged();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      setError(msg);
    }
  }

  return (
    <article
      className={`space-y-3 rounded-md border bg-card p-3 ${
        isFocused ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
      }`}
      data-testid={`episode-${episode.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono text-muted-foreground">{episode.id}</p>
          {isFocused && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              Focused source
            </span>
          )}
        </div>
        <Button variant="destructive" size="sm" onClick={() => void remove()}>
          Delete episode
        </Button>
      </div>
      <label className="block text-xs font-medium">
        User transcript
        <textarea
          aria-label={`Episode ${episode.id} input`}
          className="mt-1 min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <label className="block text-xs font-medium">
        Assistant transcript
        <textarea
          aria-label={`Episode ${episode.id} output`}
          className="mt-1 min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm"
          value={output}
          onChange={(event) => setOutput(event.target.value)}
        />
      </label>
      <Button size="sm" onClick={() => void saveTranscript()}>
        Save transcript
      </Button>
      <label className="block text-xs font-medium">
        Generated summary
        <textarea
          aria-label={`Episode ${episode.id} summary`}
          className="mt-1 min-h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <Button variant="outline" size="sm" onClick={() => void saveSummary()}>
        Save summary only
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div>
        <p className="text-xs font-medium">Derived facts ({facts.length})</p>
        {facts.map((fact) => (
          <p key={fact.id} className="mt-1 rounded border border-border p-2 text-xs">
            {fact.subject} {fact.predicate} {fact.object}
          </p>
        ))}
        {facts.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No deterministic facts found. Try phrases such as “I prefer Rust”, a URL, date, or decision.
          </p>
        )}
      </div>
    </article>
  );
}
