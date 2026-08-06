export const DEFAULT_DAEMON_URL = "http://localhost:18790";
export const DEFAULT_WS_URL = "ws://localhost:18790/ws";

export const STORAGE_KEYS = {
  DAEMON_URL: "nonclaw-daemon-url",
  SESSION_ID: "nonclaw-session-id",
  CHAT_MESSAGES: "nonclaw-chat-messages",
  DEBUG_SETTINGS: "nonclaw-debug-settings",
  THEME: "nonclaw-theme",
} as const;

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
