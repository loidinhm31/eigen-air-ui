export const DEFAULT_AUTH_TOKEN =
  "7f59e58b5014618010a76843dc864b424e02f0bcb219676bb3b57a9d5394ab0d";

export const DEFAULT_DAEMON_URL =
  typeof window !== "undefined" &&
  window.location?.hostname &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? `${window.location.protocol}//${window.location.hostname}:18790`
    : "http://localhost:18790";
export const DEFAULT_WS_URL =
  typeof window !== "undefined" &&
  window.location?.hostname &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:18790/ws`
    : "ws://localhost:18790/ws";

export const STORAGE_KEYS = {
  DAEMON_URL: "nonclaw-daemon-url",
  SESSION_ID: "nonclaw-session-id",
  AUTH_TOKEN: "nonclaw-auth-token",
  CHAT_MESSAGES: "nonclaw-chat-messages",
  DEBUG_SETTINGS: "nonclaw-debug-settings",
  THEME: "nonclaw-theme",
} as const;

export type TokenRetention = "session" | "1h" | "24h" | "7d" | "30d" | "forever";

export interface StoredTokenPayload {
  token: string;
  retention: TokenRetention;
  savedAt: number;
  expiresAt: number | null;
}

export const WS_METHODS = {
  CONNECT: "connect",
  CHAT_SEND: "chat.send",
  CHAT_HISTORY: "chat.history",
  CHAT_ABORT: "chat.abort",
  STATUS: "status",
  SESSIONS_LIST: "sessions.list",
  SESSIONS_CREATE: "sessions.create",
  SESSIONS_DELETE: "sessions.delete",
  SKILLS_LIST: "skills.list",
  SKILLS_SEARCH: "skills.search",
  MEMORY_SEARCH: "memory.search",
  CONFIG_GET: "config.get",
} as const;

export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_DELAY_MS = 2000;
