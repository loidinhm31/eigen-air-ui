import { create } from "zustand";
import type { ChatMessage } from "@nonclaw-ui/shared/types";

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamError: string | null;
  addMessage(msg: ChatMessage): void;
  appendChunk(chunk: string): void;
  finalizeStream(content: string): void;
  setStreamError(error: string): void;
  clearMessages(): void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  streamingContent: "",
  streamError: null,
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendChunk: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk, isStreaming: true })),
  finalizeStream: (content) =>
    set((s) => ({
      messages: [...s.messages, { role: "assistant", content }],
      isStreaming: false,
      streamingContent: "",
      streamError: null,
    })),
  setStreamError: (error) => set({ streamError: error, isStreaming: false, streamingContent: "" }),
  clearMessages: () =>
    set({ messages: [], streamingContent: "", isStreaming: false, streamError: null }),
}));
