import { create } from "zustand";
interface MemoryStore {
  revision: number;
  bumpRevision(): void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  revision: 0,
  bumpRevision: () => set((state) => ({ revision: state.revision + 1 })),
}));
