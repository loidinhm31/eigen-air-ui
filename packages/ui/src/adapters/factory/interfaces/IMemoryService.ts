import type {
  EpisodeUpdate,
  EpisodicMemory,
  MemoryEntry,
  MemorySearchResult,
} from "@eigen-air-ui/shared/types";

export interface MemoryServiceOptions {
  signal?: AbortSignal;
}

export interface IMemoryService {
  list(options?: MemoryServiceOptions): Promise<MemoryEntry[]>;
  store(key: string, value: unknown, options?: MemoryServiceOptions): Promise<void>;
  recall(key: string, options?: MemoryServiceOptions): Promise<MemoryEntry | null>;
  search(query: string, options?: MemoryServiceOptions): Promise<MemorySearchResult[]>;
  forget(key: string, options?: MemoryServiceOptions): Promise<void>;
  listEpisodes(options?: MemoryServiceOptions): Promise<EpisodicMemory[]>;
  getEpisode(id: string, options?: MemoryServiceOptions): Promise<EpisodicMemory | null>;
  updateEpisode(id: string, update: EpisodeUpdate, options?: MemoryServiceOptions): Promise<EpisodicMemory>;
  deleteEpisode(id: string, options?: MemoryServiceOptions): Promise<void>;
}
