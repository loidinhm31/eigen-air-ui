import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ChatMessage } from "@eigen-air-ui/shared/types";
import { STORAGE_KEYS } from "@eigen-air-ui/shared/constants";

const MAX_PERSISTED_MESSAGES = 200;
const DEFAULT_STREAM_STATUS = "Working on it...";

interface ChatStore {
  messages: ChatMessage[];
  messageRevision: number;
  isStreaming: boolean;
  streamingContent: string;
  streamStatus: string | null;
  streamError: string | null;
  addMessage(msg: ChatMessage): void;
  removeMessage(id: string): void;
  replaceMessages(messages: ChatMessage[]): void;
  beginStream(status?: string): void;
  appendChunk(chunk: string): void;
  setStreamStatus(status: string): void;
  finalizeStream(message: ChatMessage): void;
  finishStream(): void;
  setStreamError(error: string): void;
  clearMessages(): void;
}

/** Persisted-message bounds (UTF-16 code units). Storage is a hint, never authority. */
const MAX_PERSISTED_CONTENT_LENGTH = 256 * 1024;
const MAX_PERSISTED_ID_LENGTH = 512;

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PERSISTED_ID_LENGTH
    ? value
    : undefined;
}

/**
 * Strict whitelist for the persistence boundary (both directions): `role` (user/assistant/system),
 * bounded string `content`, optional bounded `id`/`run_id`. Everything else is dropped: debug,
 * tool fields and any forged extras (attachments, URLs, blobs). A message without a valid
 * role/content is dropped entirely; an invalid optional id is dropped alone. Images are never
 * persisted: the server artifact listing is the only authority for them. Persisted chat is an
 * untrusted hint (history is refetched from the server on load) and nothing consumes persisted
 * `tool_calls`/`tool_call_id`, so a restored message only needs role/content/id/run_id.
 */
function toPersistedMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const { role, content, id, run_id } = value as Record<string, unknown>;
  if (
    (role !== "user" && role !== "assistant" && role !== "system") ||
    typeof content !== "string" ||
    content.length > MAX_PERSISTED_CONTENT_LENGTH
  ) {
    return null;
  }
  const messageId = boundedId(id);
  const runId = boundedId(run_id);
  return {
    ...(messageId !== undefined ? { id: messageId } : {}),
    ...(runId !== undefined ? { run_id: runId } : {}),
    role,
    content,
  };
}

type PersistedChatState = Pick<ChatStore, "messages">;

function sanitizePersistedChatState(persistedState: unknown): PersistedChatState {
  const persisted = persistedState as Partial<PersistedChatState> | null;
  return {
    messages: Array.isArray(persisted?.messages)
      ? persisted.messages.flatMap((message) => toPersistedMessage(message) ?? [])
      : [],
  };
}

function sanitizeStoredValue(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
    const persisted = parsed as Record<string, unknown>;
    return JSON.stringify({
      ...persisted,
      state: sanitizePersistedChatState(persisted.state),
      version: 1,
    });
  } catch {
    return raw;
  }
}

const chatStorage =
  typeof localStorage !== "undefined"
    ? createJSONStorage(() => ({
        getItem: (name: string) => {
          const raw = localStorage.getItem(name);
          if (raw === null) return null;
          const sanitized = sanitizeStoredValue(raw);
          if (sanitized !== raw) localStorage.setItem(name, sanitized);
          return sanitized;
        },
        setItem: (name: string, value: string) => localStorage.setItem(name, value),
        removeItem: (name: string) => localStorage.removeItem(name),
      }))
    : undefined;

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      messageRevision: 0,
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
      addMessage: (msg) =>
        set((s) => ({
          messages: [...s.messages, msg].slice(-MAX_PERSISTED_MESSAGES),
          messageRevision: s.messageRevision + 1,
        })),
      removeMessage: (id) =>
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== id),
          messageRevision: s.messageRevision + 1,
        })),
      replaceMessages: (messages) =>
        set((s) => ({
          messages: messages.slice(-MAX_PERSISTED_MESSAGES),
          messageRevision: s.messageRevision + 1,
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
          streamError: null,
        })),
      beginStream: (status = DEFAULT_STREAM_STATUS) =>
        set({
          isStreaming: true,
          streamingContent: "",
          streamStatus: status,
          streamError: null,
        }),
      appendChunk: (chunk) =>
        set((s) => ({
          streamingContent: s.streamingContent + chunk,
          isStreaming: true,
          streamStatus: "Responding...",
          streamError: null,
        })),
      setStreamStatus: (status) =>
        set({
          isStreaming: true,
          streamStatus: status,
          streamError: null,
        }),
      finalizeStream: (message) =>
        set((s) => ({
          messages: [...s.messages, message].slice(-MAX_PERSISTED_MESSAGES),
          messageRevision: s.messageRevision + 1,
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
          streamError: null,
        })),
      finishStream: () =>
        set({
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
          streamError: null,
        }),
      setStreamError: (error) =>
        set({
          streamError: error,
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
        }),
      clearMessages: () =>
        set((s) => ({
          messages: [],
          messageRevision: s.messageRevision + 1,
          streamingContent: "",
          isStreaming: false,
          streamStatus: null,
          streamError: null,
        })),
    }),
    {
      name: STORAGE_KEYS.CHAT_MESSAGES,
      ...(chatStorage ? { storage: chatStorage } : {}),
      version: 1,
      migrate: sanitizePersistedChatState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedChatState(persistedState),
      }),
      // Debug data is intentionally ephemeral: it may be rendered for the
      // current response, but prompts and reasoning must never reach storage.
      partialize: (state) => ({
        messages: state.messages.flatMap((message) => toPersistedMessage(message) ?? []),
      }),
    }
  )
);
