import { create } from "zustand";
import type { MemorySearchResult } from "@nonclaw-ui/shared/types";

interface MemoryStore {
  keys: string[];
  searchResults: MemorySearchResult[];
  setKeys(keys: string[]): void;
  setSearchResults(results: MemorySearchResult[]): void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  keys: [],
  searchResults: [],
  setKeys: (keys) => set({ keys }),
  setSearchResults: (searchResults) => set({ searchResults }),
}));
