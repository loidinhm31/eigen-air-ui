import { create } from "zustand";
import type { ConnectionState, ConnectionStatus } from "@nonclaw-ui/shared/types";
import { DEFAULT_DAEMON_URL, STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

interface ConnectionStore extends ConnectionState {
  setUrl(url: string): void;
  setStatus(status: ConnectionStatus, version?: string): void;
  setSessionId(id: string): void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  url: (typeof localStorage !== "undefined"
    ? localStorage.getItem(STORAGE_KEYS.DAEMON_URL)
    : null) ?? DEFAULT_DAEMON_URL,
  status: "disconnected",
  version: undefined,
  sessionId: undefined,
  setUrl: (url) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.DAEMON_URL, url);
    }
    set({ url });
  },
  setStatus: (status, version) => set({ status, ...(version !== undefined ? { version } : {}) }),
  setSessionId: (sessionId) => set({ sessionId }),
}));
