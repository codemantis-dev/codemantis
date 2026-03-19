import { create } from "zustand";
import { saveTaskBoardState, loadTaskBoardState } from "../lib/tauri-commands";
import type {
  SpecConversation,
  SpecMessage,
  SpecWriterUIState,
  SpecDocumentInfo,
} from "../types/spec-writer";

/** Shape persisted to the database (reuses existing task_plans table) */
interface PersistedSpecWriterState {
  conversation: SpecConversation | null;
}

interface SpecWriterState {
  // Conversation (per project)
  conversations: Map<string, SpecConversation>;

  // UI state (per project)
  uiState: Map<string, SpecWriterUIState>;

  // Streaming state
  planningStreaming: Map<string, boolean>;

  // Current spec content being previewed (per project)
  currentSpecContent: Map<string, string>;

  // Saved specs list (per project, cached)
  savedSpecs: Map<string, SpecDocumentInfo[]>;

  // File request loading state (per project)
  fileRequestsPending: Map<string, boolean>;

  // Actions - Conversation
  initConversation: (projectPath: string, provider: string, model: string, mode: SpecConversation['mode'], templateCatalog?: string) => void;
  addMessage: (projectPath: string, message: SpecMessage) => void;
  updateLastAssistantMessage: (projectPath: string, content: string) => void;
  setConversationStatus: (projectPath: string, status: SpecConversation['status']) => void;
  setPlanningStreaming: (projectPath: string, streaming: boolean) => void;
  setMessageOptions: (projectPath: string, options: string[]) => void;
  updateConversationProvider: (projectPath: string, provider: string, model: string) => void;
  setContextLoaded: (projectPath: string, loaded: boolean) => void;
  clearConversation: (projectPath: string) => void;

  // Actions - File requests
  setFileRequestsPending: (projectPath: string, pending: boolean) => void;

  // Actions - Spec content
  setCurrentSpecContent: (projectPath: string, content: string | null) => void;

  // Actions - Saved specs
  setSavedSpecs: (projectPath: string, specs: SpecDocumentInfo[]) => void;

  // Actions - UI state
  toggleSlideOver: (projectPath: string) => void;
  setSlideOverOpen: (projectPath: string, open: boolean) => void;
  setChatWidth: (projectPath: string, width: number) => void;
  setSelectedSavedSpec: (projectPath: string, filename: string | null) => void;

  // Actions - Lifecycle
  discardAndStartNew: (projectPath: string) => Promise<void>;

  // Persistence
  persistState: (projectPath: string) => void;
  loadState: (projectPath: string) => Promise<boolean>;

  // Helpers
  getActiveConversation: (projectPath: string) => SpecConversation | undefined;
  getUIState: (projectPath: string) => SpecWriterUIState;
}

const DEFAULT_UI_STATE: SpecWriterUIState = {
  is_open: false,
  chat_width: 40,
  current_spec_content: null,
  selected_saved_spec: null,
};

export const useSpecWriterStore = create<SpecWriterState>((set, get) => ({
  conversations: new Map(),
  uiState: new Map(),
  planningStreaming: new Map(),
  currentSpecContent: new Map(),
  savedSpecs: new Map(),
  fileRequestsPending: new Map(),

  // Conversation
  initConversation: (projectPath, provider, model, mode, templateCatalog) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      conversations.set(projectPath, {
        id: `spec-${Date.now()}`,
        project_path: projectPath,
        messages: [],
        ai_provider: provider,
        ai_model: model,
        status: 'gathering',
        mode,
        context_loaded: false,
        templateCatalog,
      });
      return { conversations };
    }),

  addMessage: (projectPath, message) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, {
          ...conv,
          messages: [...conv.messages, message],
        });
      }
      return { conversations };
    }),

  updateLastAssistantMessage: (projectPath, content) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], content };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  setConversationStatus: (projectPath, status) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, status });
      }
      return { conversations };
    }),

  setPlanningStreaming: (projectPath, streaming) =>
    set((state) => {
      const planningStreaming = new Map(state.planningStreaming);
      planningStreaming.set(projectPath, streaming);
      return { planningStreaming };
    }),

  setMessageOptions: (projectPath, options) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv && conv.messages.length > 0) {
        const messages = [...conv.messages];
        const lastIdx = messages.length - 1;
        if (messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], parsedOptions: options };
        }
        conversations.set(projectPath, { ...conv, messages });
      }
      return { conversations };
    }),

  updateConversationProvider: (projectPath, provider, model) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, ai_provider: provider, ai_model: model });
      }
      return { conversations };
    }),

  setContextLoaded: (projectPath, loaded) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const conv = conversations.get(projectPath);
      if (conv) {
        conversations.set(projectPath, { ...conv, context_loaded: loaded });
      }
      return { conversations };
    }),

  clearConversation: (projectPath) =>
    set((state) => {
      const conversations = new Map(state.conversations);
      const currentSpecContent = new Map(state.currentSpecContent);
      conversations.delete(projectPath);
      currentSpecContent.delete(projectPath);
      return { conversations, currentSpecContent };
    }),

  // File requests
  setFileRequestsPending: (projectPath, pending) =>
    set((state) => {
      const fileRequestsPending = new Map(state.fileRequestsPending);
      fileRequestsPending.set(projectPath, pending);
      return { fileRequestsPending };
    }),

  // Spec content
  setCurrentSpecContent: (projectPath, content) =>
    set((state) => {
      const currentSpecContent = new Map(state.currentSpecContent);
      if (content === null) {
        currentSpecContent.delete(projectPath);
      } else {
        currentSpecContent.set(projectPath, content);
      }
      return { currentSpecContent };
    }),

  // Saved specs
  setSavedSpecs: (projectPath, specs) =>
    set((state) => {
      const savedSpecs = new Map(state.savedSpecs);
      savedSpecs.set(projectPath, specs);
      return { savedSpecs };
    }),

  // UI state
  toggleSlideOver: (projectPath) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: !current.is_open });
      return { uiState };
    }),

  setSlideOverOpen: (projectPath, open) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, is_open: open });
      return { uiState };
    }),

  setChatWidth: (projectPath, width) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, chat_width: width });
      return { uiState };
    }),

  setSelectedSavedSpec: (projectPath, filename) =>
    set((state) => {
      const uiState = new Map(state.uiState);
      const current = uiState.get(projectPath) ?? { ...DEFAULT_UI_STATE };
      uiState.set(projectPath, { ...current, selected_saved_spec: filename });
      return { uiState };
    }),

  // Lifecycle
  discardAndStartNew: async (projectPath) => {
    set((s) => {
      const conversations = new Map(s.conversations);
      const currentSpecContent = new Map(s.currentSpecContent);
      conversations.delete(projectPath);
      currentSpecContent.delete(projectPath);
      return { conversations, currentSpecContent };
    });
  },

  // Persistence (reuses task_plans table via existing commands)
  persistState: (projectPath) => {
    const state = get();
    const conversation = state.conversations.get(projectPath) ?? null;
    if (!conversation) return;
    const persisted: PersistedSpecWriterState = { conversation };
    saveTaskBoardState(projectPath, JSON.stringify(persisted)).catch((e) =>
      console.error("[specWriterStore] Failed to persist state:", e)
    );
  },

  loadState: async (projectPath) => {
    try {
      const json = await loadTaskBoardState(projectPath);
      if (!json) return false;
      const persisted = JSON.parse(json);
      // Handle both old TaskBoard format and new SpecWriter format
      const conversation = persisted.conversation ?? null;
      if (!conversation) return false;
      set((state) => {
        const conversations = new Map(state.conversations);
        conversations.set(projectPath, conversation);
        return { conversations };
      });
      return true;
    } catch (e) {
      console.error("[specWriterStore] Failed to load state:", e);
      return false;
    }
  },

  // Helpers
  getActiveConversation: (projectPath) => get().conversations.get(projectPath),
  getUIState: (projectPath) =>
    get().uiState.get(projectPath) ?? DEFAULT_UI_STATE,
}));
