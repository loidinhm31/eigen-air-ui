import * as React from "react";
import { useLocation } from "react-router-dom";
import { MemoryBrowser } from "../organisms/MemoryBrowser.js";
import { EpisodeBrowser } from "../organisms/EpisodeBrowser.js";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";

function useSafeBasePathNavigation() {
  try {
    return useBasePathNavigation();
  } catch {
    return { to: (p: string) => p, navigate: () => undefined };
  }
}

function useSafeLocationSearch(): string {
  try {
    return useLocation().search;
  } catch {
    return typeof window !== "undefined" ? window.location.search : "";
  }
}

export interface MemoryPageProps {
  episodeId?: string;
}

export function MemoryPage({ episodeId: propEpisodeId }: MemoryPageProps = {}) {
  const { navigate } = useSafeBasePathNavigation();
  const locationSearch = useSafeLocationSearch();
  const searchParams = React.useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const urlEpisodeId = propEpisodeId ?? (searchParams.get("episode_id")?.trim() || undefined);

  const handleClearFocus = React.useCallback(() => {
    navigate("/memory");
  }, [navigate]);

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      <MemoryBrowser />
      <EpisodeBrowser focusedEpisodeId={urlEpisodeId} onClearFocus={handleClearFocus} />
    </div>
  );
}
MemoryPage.displayName = "MemoryPage";
