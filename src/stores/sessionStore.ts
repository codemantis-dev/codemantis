import { create } from "zustand";
import type { Session, Message } from "../types/session";

interface SessionState {
  session: Session | null;
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;

  setSession: (session: Session | null) => void;
  addMessage: (message: Message) => void;
  appendStreamingContent: (text: string) => void;
  finalizeStreaming: (fullText?: string) => void;
  startStreaming: (messageId: string) => void;
  updateModel: (model: string) => void;
  clearMessages: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  currentMessageId: null,

  setSession: (session) => set({ session }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  startStreaming: (messageId) =>
    set({
      isStreaming: true,
      streamingContent: "",
      currentMessageId: messageId,
    }),

  appendStreamingContent: (text) =>
    set((state) => ({
      streamingContent: state.streamingContent + text,
    })),

  finalizeStreaming: (fullText) =>
    set((state) => {
      const content = fullText ?? state.streamingContent;
      const currentId = state.currentMessageId;
      if (!currentId) return { isStreaming: false, streamingContent: "", currentMessageId: null };

      const existingIdx = state.messages.findIndex((m) => m.id === currentId);
      if (existingIdx >= 0) {
        const updated = [...state.messages];
        updated[existingIdx] = {
          ...updated[existingIdx],
          content: updated[existingIdx].content + content,
          isStreaming: false,
        };
        return {
          messages: updated,
          isStreaming: false,
          streamingContent: "",
          currentMessageId: null,
        };
      }

      return {
        isStreaming: false,
        streamingContent: "",
        currentMessageId: null,
      };
    }),

  updateModel: (model) =>
    set((state) => ({
      session: state.session ? { ...state.session, model } : null,
    })),

  clearMessages: () => set({ messages: [], streamingContent: "", isStreaming: false }),
}));
