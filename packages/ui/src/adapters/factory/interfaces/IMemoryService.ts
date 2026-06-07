import type {
  EpisodeUpdate,
  EpisodicMemory,
  MemoryEntry,
  MemorySearchResult,
} from "@nonclaw-ui/shared/types";

export interface IMemoryService {
  list(): Promise<MemoryEntry[]>;
  store(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<MemoryEntry | null>;
  search(query: string): Promise<MemorySearchResult[]>;
  forget(key: string): Promise<void>;
  listEpisodes(): Promise<EpisodicMemory[]>;
  getEpisode(id: string): Promise<EpisodicMemory | null>;
  updateEpisode(id: string, update: EpisodeUpdate): Promise<EpisodicMemory>;
  deleteEpisode(id: string): Promise<void>;
}
