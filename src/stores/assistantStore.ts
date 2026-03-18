import { create } from "zustand";
import type { Message } from "../types/session";
import type { AIProvider } from "../types/assistant-provider";
import type { Attachment } from "../types/attachment";

interface StreamingState {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AssistantInstance {
  id: string;          // sessionId from the CLI, or a generated ID for API providers
  projectPath: string;
  parentSessionId: string; // main session tab that created this assistant
  name: string;
  provider: AIProvider;
  model: string | null; // null for claude-code (uses CLI's model)
  sortOrder: number;
  createdAt: string;
}

const DEFAULT_STREAMING: StreamingState = {
  isStreaming: false,
  streamingContent: "",
  currentMessageId: null,
};

interface AssistantState {
  // Multiple assistants per project (mirrors terminalStore pattern)
  projectAssistants: Map<string, AssistantInstance[]>;  // projectPath → instances
  activeAssistantId: Map<string, string | null>;        // parentSessionId → active assistant id

  // Per-session data
  messages: Map<string, Message[]>;       // sessionId → messages
  streaming: Map<string, StreamingState>; // sessionId → streaming state
  busy: Map<string, boolean>;             // sessionId → is processing
  sessionCost: Map<string, TokenUsage>;   // sessionId → cumulative token usage
  attachments: Map<string, Attachment[]>; // sessionId → attachments
  cliSessionIds: Map<string, string>;    // sessionId → Claude CLI session ID (for --resume)

  // Instance management
  addAssistant: (projectPath: string, instance: AssistantInstance) => void;
  removeAssistant: (projectPath: string, sessionId: string) => void;
  setActiveAssistant: (parentSessionId: string, sessionId: string | null) => void;
  renameAssistant: (projectPath: string, sessionId: string, newName: string) => void;
  getAssistants: (projectPath: string) => AssistantInstance[];
  getActiveAssistantId: (parentSessionId: string) => string | null;
  getAllSessionIds: (projectPath: string) => string[];
  clearProject: (projectPath: string) => void;

  // Per-session message actions
  addMessage: (sessionId: string, message: Message) => void;
  startStreaming: (sessionId: string, messageId: string) => void;
  appendStreamingContent: (sessionId: string, text: string) => void;
  finalizeStreaming: (sessionId: string, fullText?: string) => void;
  setBusy: (sessionId: string, busy: boolean) => void;
  clearMessages: (sessionId: string) => void;
  addTokenUsage: (sessionId: string, inputTokens: number, outputTokens: number) => void;
  getTokenUsage: (sessionId: string) => TokenUsage;

  // CLI session ID tracking (for Claude Code assistants)
  setCliSessionId: (sessionId: string, cliSessionId: string) => void;
  getCliSessionId: (sessionId: string) => string | undefined;

  // Remove all messages after a given messageId (for retry)
  removeMessagesAfter: (sessionId: string, messageId: string) => void;

  // Per-session attachment actions
  addAssistantAttachment: (sessionId: string, attachment: Attachment) => void;
  removeAssistantAttachment: (sessionId: string, attachmentId: string) => void;
  clearAssistantAttachments: (sessionId: string) => void;

  // Lookup helpers
  findAssistantInstance: (sessionId: string) => AssistantInstance | undefined;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  projectAssistants: new Map(),
  activeAssistantId: new Map(),
  messages: new Map(),
  streaming: new Map(),
  busy: new Map(),
  sessionCost: new Map(),
  attachments: new Map(),
  cliSessionIds: new Map(),

  addAssistant: (projectPath, instance) =>
    set((state) => {
      const projectAssistants = new Map(state.projectAssistants);
      const list = [...(projectAssistants.get(projectPath) ?? []), instance];
      projectAssistants.set(projectPath, list);

      const activeAssistantId = new Map(state.activeAssistantId);
      activeAssistantId.set(instance.parentSessionId, instance.id);

      const messages = new Map(state.messages);
      messages.set(instance.id, []);
      const streaming = new Map(state.streaming);
      streaming.set(instance.id, { ...DEFAULT_STREAMING });
      const busy = new Map(state.busy);
      busy.set(instance.id, false);
      const sessionCost = new Map(state.sessionCost);
      sessionCost.set(instance.id, { inputTokens: 0, outputTokens: 0 });
      const attachments = new Map(state.attachments);
      attachments.set(instance.id, []);

      return { projectAssistants, activeAssistantId, messages, streaming, busy, sessionCost, attachments };
    }),

  removeAssistant: (projectPath, sessionId) =>
    set((state) => {
      const projectAssistants = new Map(state.projectAssistants);
      const allList = projectAssistants.get(projectPath) ?? [];
      const removed = allList.find((a) => a.id === sessionId);
      const list = allList.filter((a) => a.id !== sessionId);
      projectAssistants.set(projectPath, list);

      const activeAssistantId = new Map(state.activeAssistantId);
      if (removed) {
        const parentKey = removed.parentSessionId;
        if (activeAssistantId.get(parentKey) === sessionId) {
          const siblings = list.filter((a) => a.parentSessionId === parentKey);
          activeAssistantId.set(
            parentKey,
            siblings.length > 0 ? siblings[siblings.length - 1].id : null
          );
        }
      }

      const messages = new Map(state.messages);
      messages.delete(sessionId);
      const streaming = new Map(state.streaming);
      streaming.delete(sessionId);
      const busy = new Map(state.busy);
      busy.delete(sessionId);
      const sessionCost = new Map(state.sessionCost);
      sessionCost.delete(sessionId);
      const attachments = new Map(state.attachments);
      attachments.delete(sessionId);
      const cliSessionIds = new Map(state.cliSessionIds);
      cliSessionIds.delete(sessionId);

      return { projectAssistants, activeAssistantId, messages, streaming, busy, sessionCost, attachments, cliSessionIds };
    }),

  setActiveAssistant: (parentSessionId, sessionId) =>
    set((state) => {
      const activeAssistantId = new Map(state.activeAssistantId);
      activeAssistantId.set(parentSessionId, sessionId);
      return { activeAssistantId };
    }),

  renameAssistant: (projectPath, sessionId, newName) =>
    set((state) => {
      const projectAssistants = new Map(state.projectAssistants);
      const list = [...(projectAssistants.get(projectPath) ?? [])];
      const idx = list.findIndex((a) => a.id === sessionId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], name: newName };
        projectAssistants.set(projectPath, list);
      }
      return { projectAssistants };
    }),

  getAssistants: (projectPath) =>
    get().projectAssistants.get(projectPath) ?? [],

  getActiveAssistantId: (parentSessionId) =>
    get().activeAssistantId.get(parentSessionId) ?? null,

  getAllSessionIds: (projectPath) =>
    (get().projectAssistants.get(projectPath) ?? []).map((a) => a.id),

  clearProject: (projectPath) =>
    set((state) => {
      const assistants = state.projectAssistants.get(projectPath) ?? [];
      const projectAssistants = new Map(state.projectAssistants);
      projectAssistants.delete(projectPath);
      const activeAssistantId = new Map(state.activeAssistantId);
      for (const a of assistants) {
        activeAssistantId.delete(a.parentSessionId);
      }

      const messages = new Map(state.messages);
      const streaming = new Map(state.streaming);
      const busy = new Map(state.busy);
      const sessionCost = new Map(state.sessionCost);
      const attachments = new Map(state.attachments);
      const cliSessionIds = new Map(state.cliSessionIds);
      for (const a of assistants) {
        messages.delete(a.id);
        streaming.delete(a.id);
        busy.delete(a.id);
        sessionCost.delete(a.id);
        attachments.delete(a.id);
        cliSessionIds.delete(a.id);
      }

      return { projectAssistants, activeAssistantId, messages, streaming, busy, sessionCost, attachments, cliSessionIds };
    }),

  // Per-session message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) ?? [];
      messages.set(sessionId, [...existing, message]);
      return { messages };
    }),

  startStreaming: (sessionId, messageId) =>
    set((state) => {
      const streaming = new Map(state.streaming);
      streaming.set(sessionId, {
        isStreaming: true,
        streamingContent: "",
        currentMessageId: messageId,
      });
      return { streaming };
    }),

  appendStreamingContent: (sessionId, text) =>
    set((state) => {
      const streaming = new Map(state.streaming);
      const current = streaming.get(sessionId) ?? { ...DEFAULT_STREAMING };
      streaming.set(sessionId, {
        ...current,
        streamingContent: current.streamingContent + text,
      });
      return { streaming };
    }),

  finalizeStreaming: (sessionId, fullText) =>
    set((state) => {
      const streamState = state.streaming.get(sessionId);
      if (!streamState?.currentMessageId) {
        const streaming = new Map(state.streaming);
        streaming.set(sessionId, { ...DEFAULT_STREAMING });
        return { streaming };
      }

      const currentId = streamState.currentMessageId;
      const content = fullText ?? streamState.streamingContent;

      const messages = new Map(state.messages);
      const msgList = [...(messages.get(sessionId) ?? [])];
      const idx = msgList.findIndex((m) => m.id === currentId);
      if (idx >= 0) {
        msgList[idx] = { ...msgList[idx], content, isStreaming: false };
        messages.set(sessionId, msgList);
      }

      const streaming = new Map(state.streaming);
      streaming.set(sessionId, { ...DEFAULT_STREAMING });

      return { messages, streaming };
    }),

  setBusy: (sessionId, busy) =>
    set((state) => {
      const busyMap = new Map(state.busy);
      busyMap.set(sessionId, busy);
      return { busy: busyMap };
    }),

  clearMessages: (sessionId) =>
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(sessionId, []);
      const streaming = new Map(state.streaming);
      streaming.set(sessionId, { ...DEFAULT_STREAMING });
      return { messages, streaming };
    }),

  addTokenUsage: (sessionId, inputTokens, outputTokens) =>
    set((state) => {
      const sessionCost = new Map(state.sessionCost);
      const existing = sessionCost.get(sessionId) ?? { inputTokens: 0, outputTokens: 0 };
      sessionCost.set(sessionId, {
        inputTokens: existing.inputTokens + inputTokens,
        outputTokens: existing.outputTokens + outputTokens,
      });
      return { sessionCost };
    }),

  getTokenUsage: (sessionId) =>
    get().sessionCost.get(sessionId) ?? { inputTokens: 0, outputTokens: 0 },

  setCliSessionId: (sessionId, cliSessionId) =>
    set((state) => {
      const cliSessionIds = new Map(state.cliSessionIds);
      cliSessionIds.set(sessionId, cliSessionId);
      return { cliSessionIds };
    }),

  getCliSessionId: (sessionId) =>
    get().cliSessionIds.get(sessionId),

  removeMessagesAfter: (sessionId, messageId) =>
    set((state) => {
      const messages = new Map(state.messages);
      const msgList = messages.get(sessionId) ?? [];
      const idx = msgList.findIndex((m) => m.id === messageId);
      if (idx >= 0) {
        messages.set(sessionId, msgList.slice(0, idx + 1));
      }
      return { messages };
    }),

  addAssistantAttachment: (sessionId, attachment) =>
    set((state) => {
      const attachments = new Map(state.attachments);
      const existing = attachments.get(sessionId) ?? [];
      attachments.set(sessionId, [...existing, attachment]);
      return { attachments };
    }),

  removeAssistantAttachment: (sessionId, attachmentId) =>
    set((state) => {
      const attachments = new Map(state.attachments);
      const existing = attachments.get(sessionId) ?? [];
      attachments.set(sessionId, existing.filter((a) => a.id !== attachmentId));
      return { attachments };
    }),

  clearAssistantAttachments: (sessionId) =>
    set((state) => {
      const attachments = new Map(state.attachments);
      attachments.set(sessionId, []);
      return { attachments };
    }),

  findAssistantInstance: (sessionId) => {
    for (const instances of get().projectAssistants.values()) {
      const found = instances.find((a) => a.id === sessionId);
      if (found) return found;
    }
    return undefined;
  },
}));
