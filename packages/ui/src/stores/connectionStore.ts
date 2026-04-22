import { create } from "zustand";
import type { ConnectionState, ConnectionStatus } from "@nonclaw-ui/shared/types";
import { DEFAULT_DAEMON_URL, STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

interface ConnectionStore extends ConnectionState {
  setUrl(url: string): void;
  setStatus(status: ConnectionStatus, version?: string): void;
  setSessionId(id: string | undefined): void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  url: (typeof localStorage !== "undefined"
    ? localStorage.getItem(STORAGE_KEYS.DAEMON_URL)
    : null) ?? DEFAULT_DAEMON_URL,
  status: "disconnected",
  version: undefined,
  sessionId: (typeof localStorage !== "undefined"
    ? localStorage.getItem(STORAGE_KEYS.SESSION_ID) ?? undefined
    : undefined),
  setUrl: (url) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.DAEMON_URL, url);
    }
    set({ url });
  },
  setStatus: (status, version) => set({ status, ...(version !== undefined ? { version } : {}) }),
  setSessionId: (sessionId) => {
    if (typeof localStorage !== "undefined") {
      if (sessionId) localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
      else localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
    }
    set({ sessionId });
  },
}));
