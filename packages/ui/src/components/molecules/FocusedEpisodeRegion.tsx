import * as React from "react";
import { Button } from "../atoms/Button.js";
import { EpisodeCard } from "./EpisodeCard.js";
import type { EpisodicMemory } from "@eigen-air-ui/shared/types";

export type FocusLookupStatus = "idle" | "loading" | "found" | "unavailable" | "auth_denied" | "error";

export interface FocusLookupState {
  status: FocusLookupStatus;
  episode: EpisodicMemory | null;
  errorMessage?: string;
}

export interface FocusedEpisodeRegionProps {
  episodeId: string;
  focusState: FocusLookupState;
  onClearFocus?: () => void;
  onRetry: () => void;
  onEpisodeChanged: () => Promise<void>;
}

export function FocusedEpisodeRegion({
  episodeId,
  focusState,
  onClearFocus,
  onRetry,
  onEpisodeChanged,
}: FocusedEpisodeRegionProps) {
  return (
    <div
      className="space-y-3 rounded-md border border-primary/30 bg-muted/20 p-3"
      data-testid="focused-episode-container"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Lineage focus
          </span>
          <span className="text-xs font-mono text-muted-foreground">{episodeId}</span>
        </div>
        {onClearFocus && (
          <Button variant="outline" size="sm" onClick={onClearFocus}>
            Show all episodes
          </Button>
        )}
      </div>

      {focusState.status === "loading" && (
        <p role="status" className="py-2 text-center text-xs text-muted-foreground">
          Loading episode {episodeId}…
        </p>
      )}

      {focusState.status === "unavailable" && (
        <div role="status" className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p className="font-semibold text-foreground">Source unavailable</p>
          <p className="text-muted-foreground">
            The requested episode source does not exist, was deleted, or is not accessible in your authorized scope.
          </p>
        </div>
      )}

      {focusState.status === "auth_denied" && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-semibold text-destructive">Access denied</p>
          <p className="text-muted-foreground">
            {focusState.errorMessage ?? "You are not authorized to view this memory episode."}
          </p>
        </div>
      )}

      {focusState.status === "error" && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="font-semibold text-destructive">Failed to load episode</p>
          <p className="text-muted-foreground">
            {focusState.errorMessage ?? "A network or server error occurred while retrieving this episode."}
          </p>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}

      {focusState.status === "found" && focusState.episode && (
        <EpisodeCard
          key={focusState.episode.id}
          episode={focusState.episode}
          isFocused={true}
          onChanged={onEpisodeChanged}
        />
      )}
    </div>
  );
}
