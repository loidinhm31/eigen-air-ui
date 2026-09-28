import * as React from "react";
import { useEffect, useState } from "react";
import { getMemoryService } from "../../adapters/factory/ServiceFactory.js";
import { MemoryHttpError } from "../../adapters/http/HttpMemoryAdapter.js";
import { Button } from "../atoms/Button.js";
import { EpisodeCard } from "../molecules/EpisodeCard.js";
import {
  FocusedEpisodeRegion,
  type FocusLookupState,
} from "../molecules/FocusedEpisodeRegion.js";
import { useMemoryStore } from "../../stores/memoryStore.js";
import type { EpisodicMemory } from "@eigen-air-ui/shared/types";

export interface EpisodeBrowserProps {
  focusedEpisodeId?: string;
  onClearFocus?: () => void;
}

export function EpisodeBrowser({ focusedEpisodeId, onClearFocus }: EpisodeBrowserProps = {}) {
  const [episodes, setEpisodes] = useState<EpisodicMemory[]>([]);
  const [focusState, setFocusState] = useState<FocusLookupState>({
    status: focusedEpisodeId ? "loading" : "idle",
    episode: null,
  });
  const focusGeneration = React.useRef(0);
  const focusAbort = React.useRef<AbortController | null>(null);
  const revision = useMemoryStore((state) => state.revision);

  const lookupFocusedEpisode = React.useCallback(async (episodeId: string) => {
    const currentGen = ++focusGeneration.current;
    if (focusAbort.current) {
      focusAbort.current.abort();
    }
    const controller = new AbortController();
    focusAbort.current = controller;

    setFocusState({ status: "loading", episode: null });

    try {
      const episode = await getMemoryService().getEpisode(episodeId, {
        signal: controller.signal,
      });
      if (currentGen !== focusGeneration.current) return;

      if (!episode) {
        setFocusState({ status: "unavailable", episode: null });
        return;
      }

      setFocusState({ status: "found", episode });
    } catch (err) {
      if (currentGen !== focusGeneration.current) return;
      if (err instanceof MemoryHttpError) {
        if (err.kind === "unauthorized" || err.kind === "forbidden") {
          setFocusState({
            status: "auth_denied",
            episode: null,
            errorMessage: err.message,
          });
          return;
        }
        if (err.kind === "aborted") {
          return;
        }
      }
      const message = err instanceof Error ? err.message : "Failed to load episode";
      setFocusState({
        status: "error",
        episode: null,
        errorMessage: message,
      });
    }
  }, []);

  useEffect(() => {
    if (focusedEpisodeId) {
      void lookupFocusedEpisode(focusedEpisodeId);
    } else {
      setFocusState({ status: "idle", episode: null });
    }
    return () => {
      if (focusAbort.current) {
        focusAbort.current.abort();
      }
    };
  }, [focusedEpisodeId, lookupFocusedEpisode, revision]);

  const load = React.useCallback(async () => {
    try {
      setEpisodes(await getMemoryService().listEpisodes());
    } catch {
      // If list fails, preserve existing episodes
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      {focusedEpisodeId && (
        <FocusedEpisodeRegion
          episodeId={focusedEpisodeId}
          focusState={focusState}
          onClearFocus={onClearFocus}
          onRetry={() => void lookupFocusedEpisode(focusedEpisodeId)}
          onEpisodeChanged={async () => {
            await lookupFocusedEpisode(focusedEpisodeId);
            await load();
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {focusedEpisodeId ? "All episodes" : "Episodes"}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {episodes.map((episode) => (
        <EpisodeCard
          key={episode.id}
          episode={episode}
          isFocused={false}
          onChanged={async () => {
            if (focusedEpisodeId && episode.id === focusedEpisodeId) {
              await lookupFocusedEpisode(focusedEpisodeId);
            }
            await load();
          }}
        />
      ))}
      {episodes.length === 0 && <p className="text-sm text-muted-foreground">No episodes yet</p>}
    </section>
  );
}
EpisodeBrowser.displayName = "EpisodeBrowser";
