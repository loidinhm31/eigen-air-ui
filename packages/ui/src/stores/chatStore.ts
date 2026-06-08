import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "@nonclaw-ui/shared/types";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

const MAX_PERSISTED_MESSAGES = 200;
const DEFAULT_STREAM_STATUS = "Working on it...";

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamStatus: string | null;
  streamError: string | null;
  addMessage(msg: ChatMessage): void;
  replaceMessages(messages: ChatMessage[]): void;
  beginStream(status?: string): void;
  appendChunk(chunk: string): void;
  setStreamStatus(status: string): void;
  finalizeStream(content: string): void;
  setStreamError(error: string): void;
  clearMessages(): void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
      addMessage: (msg) =>
        set((s) => ({
          messages: [...s.messages, msg].slice(-MAX_PERSISTED_MESSAGES),
        })),
      replaceMessages: (messages) =>
        set({
          messages: messages.slice(-MAX_PERSISTED_MESSAGES),
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
          streamError: null,
        }),
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
      finalizeStream: (content) =>
        set((s) => ({
          messages: [...s.messages, { role: "assistant" as const, content }].slice(-MAX_PERSISTED_MESSAGES),
          isStreaming: false,
          streamingContent: "",
          streamStatus: null,
          streamError: null,
        })),
      setStreamError: (error) =>
        set({ streamError: error, isStreaming: false, streamingContent: "", streamStatus: null }),
      clearMessages: () =>
        set({ messages: [], streamingContent: "", isStreaming: false, streamStatus: null, streamError: null }),
    }),
    {
      name: STORAGE_KEYS.CHAT_MESSAGES,
      // Only persist messages; transient streaming state is never stored
      partialize: (state) => ({ messages: state.messages }),
    }
  )
);
