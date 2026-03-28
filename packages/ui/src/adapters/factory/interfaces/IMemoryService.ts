import type { MemoryEntry, MemorySearchResult } from "@nonclaw-ui/shared/types";

export interface IMemoryService {
  list(): Promise<string[]>;
  store(key: string, value: string): Promise<void>;
  recall(key: string): Promise<MemoryEntry | null>;
  search(query: string): Promise<MemorySearchResult[]>;
  forget(key: string): Promise<void>;
}
