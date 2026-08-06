import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

interface DebugSettingsStore {
  showPromptDebug: boolean;
  showReasoningDebug: boolean;
  setShowPromptDebug(value: boolean): void;
  setShowReasoningDebug(value: boolean): void;
}

const storage =
  typeof localStorage !== "undefined"
    ? createJSONStorage(() => localStorage)
    : undefined;

export const useDebugSettingsStore = create<DebugSettingsStore>()(
  persist(
    (set) => ({
      showPromptDebug: false,
      showReasoningDebug: false,
      setShowPromptDebug: (value) => set({ showPromptDebug: value }),
      setShowReasoningDebug: (value) => set({ showReasoningDebug: value }),
    }),
    {
      name: STORAGE_KEYS.DEBUG_SETTINGS,
      ...(storage ? { storage } : {}),
    }
  )
);
