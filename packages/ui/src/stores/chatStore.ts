import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "@nonclaw-ui/shared/types";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

const MAX_PERSISTED_MESSAGES = 200;

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamError: string | null;
  addMessage(msg: ChatMessage): void;
  replaceMessages(messages: ChatMessage[]): void;
  appendChunk(chunk: string): void;
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
          streamError: null,
        }),
      appendChunk: (chunk) =>
        set((s) => ({ streamingContent: s.streamingContent + chunk, isStreaming: true })),
      finalizeStream: (content) =>
        set((s) => ({
          messages: [...s.messages, { role: "assistant" as const, content }].slice(-MAX_PERSISTED_MESSAGES),
          isStreaming: false,
          streamingContent: "",
          streamError: null,
        })),
      setStreamError: (error) => set({ streamError: error, isStreaming: false, streamingContent: "" }),
      clearMessages: () =>
        set({ messages: [], streamingContent: "", isStreaming: false, streamError: null }),
    }),
    {
      name: STORAGE_KEYS.CHAT_MESSAGES,
      // Only persist messages; transient streaming state is never stored
      partialize: (state) => ({ messages: state.messages }),
    }
  )
);
