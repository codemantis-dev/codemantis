import { create } from "zustand";
import type { ActivityEntry, ApprovalDecision } from "../types/activity";

export interface PendingApproval {
  requestId: string;
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  timestamp: string;
}

export interface QuestionOption {
  label: string;
  value: string;
  description: string;
}

export interface QuestionItem {
  header: string;
  question: string;
  multiSelect: boolean;
  options: QuestionOption[];
  /** Codex `item/tool/requestUserInput` carries a per-question `id` that
   * keys the structured response (`{ answers: { [id]: { answers: [] } } }`).
   * Claude's AskUserQuestion has no id — the question text itself is the
   * key in the synthesised reply paragraph. Optional so both paths work. */
  id?: string;
  isOther?: boolean;
  isSecret?: boolean;
}

export interface PendingQuestion {
  toolUseId: string;
  requestId: string;
  sessionId: string;
  question?: string;
  questions?: QuestionItem[];
  /** Discriminator: "claude" → answers route through send_user_message
   * (the existing Claude flow). "codex" → answers route through
   * respond_to_approval with a structured `{ answers: { [id]: ... } }`
   * payload. Set by useToolApprovalListener when classifying the
   * tool-approval-request event. */
  agentKind?: "claude" | "codex";
}

interface ActivityState {
  sessionEntries: Map<string, ActivityEntry[]>;
  sessionQuestions: Map<string, PendingQuestion | null>;
  alwaysAllowedTools: Map<string, Set<string>>; // sessionId → Set of tool names

  // Queue-based approval system
  approvalQueue: PendingApproval[];
  approvalSeenIds: Set<string>;
  currentApprovalIndex: number;

  addEntry: (sessionId: string, entry: ActivityEntry) => void;
  updateEntryStatus: (
    sessionId: string,
    toolUseId: string,
    status: ActivityEntry["status"],
    result?: string,
    isError?: boolean
  ) => void;
  enqueueApproval: (approval: PendingApproval) => void;
  dequeueApproval: (toolUseId: string) => void;
  setCurrentApprovalIndex: (index: number) => void;
  getCurrentApproval: () => PendingApproval | undefined;
  getApprovalQueueSize: () => number;
  recordApprovalDecision: (
    sessionId: string,
    toolUseId: string,
    decision: ApprovalDecision
  ) => void;
  setPendingQuestion: (
    sessionId: string,
    question: PendingQuestion | null
  ) => void;
  addAlwaysAllowedTool: (sessionId: string, toolName: string) => void;
  isToolAlwaysAllowed: (sessionId: string, toolName: string) => boolean;
  updateEntryExtra: (sessionId: string, toolUseId: string, extra: Partial<ActivityEntry>) => void;
  getEntriesForMessage: (sessionId: string, messageId: string) => ActivityEntry[];
  getActiveEntries: (sessionId: string) => ActivityEntry[];
  clearEntries: (sessionId: string) => void;
  clearApprovalState: (sessionId: string) => void;
  clearAllEntries: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  sessionEntries: new Map(),
  sessionQuestions: new Map(),
  alwaysAllowedTools: new Map<string, Set<string>>(),

  approvalQueue: [],
  approvalSeenIds: new Set<string>(),
  currentApprovalIndex: 0,

  addEntry: (sessionId, entry) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = [...(sessionEntries.get(sessionId) ?? []), entry];
      // Cap entries per session to prevent unbounded growth
      const MAX_ENTRIES = 500;
      if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
      }
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  updateEntryStatus: (sessionId, toolUseId, status, result, isError) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = (sessionEntries.get(sessionId) ?? []).map((e) =>
        e.toolUseId === toolUseId
          ? { ...e, status, result: result ?? e.result, isError: isError ?? e.isError }
          : e
      );
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  enqueueApproval: (approval) =>
    set((state) => {
      if (state.approvalSeenIds.has(approval.toolUseId)) {
        return {};
      }
      const approvalSeenIds = new Set(state.approvalSeenIds);
      approvalSeenIds.add(approval.toolUseId);
      return {
        approvalQueue: [...state.approvalQueue, approval],
        approvalSeenIds,
      };
    }),

  dequeueApproval: (toolUseId) =>
    set((state) => {
      const approvalQueue = state.approvalQueue.filter(
        (a) => a.toolUseId !== toolUseId
      );
      const currentApprovalIndex = Math.min(
        state.currentApprovalIndex,
        Math.max(0, approvalQueue.length - 1)
      );
      return { approvalQueue, currentApprovalIndex };
    }),

  setCurrentApprovalIndex: (index) =>
    set((state) => ({
      currentApprovalIndex: Math.max(
        0,
        Math.min(index, state.approvalQueue.length - 1)
      ),
    })),

  getCurrentApproval: () => {
    const state = get();
    return state.approvalQueue[state.currentApprovalIndex];
  },

  getApprovalQueueSize: () => get().approvalQueue.length,

  recordApprovalDecision: (sessionId, toolUseId, decision) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = (sessionEntries.get(sessionId) ?? []).map((e) =>
        e.toolUseId === toolUseId
          ? {
              ...e,
              approvalStatus: decision,
              approvalTimestamp: new Date().toISOString(),
            }
          : e
      );
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  setPendingQuestion: (sessionId, question) =>
    set((state) => {
      const sessionQuestions = new Map(state.sessionQuestions);
      sessionQuestions.set(sessionId, question);
      return { sessionQuestions };
    }),

  addAlwaysAllowedTool: (sessionId, toolName) =>
    set((state) => {
      const updated = new Map(state.alwaysAllowedTools);
      const tools = new Set(updated.get(sessionId) ?? []);
      tools.add(toolName);
      updated.set(sessionId, tools);
      return { alwaysAllowedTools: updated };
    }),

  updateEntryExtra: (sessionId, toolUseId, extra) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = (sessionEntries.get(sessionId) ?? []).map((e) =>
        e.toolUseId === toolUseId ? { ...e, ...extra } : e
      );
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  isToolAlwaysAllowed: (sessionId, toolName) => {
    const tools = get().alwaysAllowedTools.get(sessionId);
    return tools?.has(toolName) ?? false;
  },

  getEntriesForMessage: (sessionId, messageId) => {
    const entries = get().sessionEntries.get(sessionId) ?? [];
    return entries.filter((e) => e.messageId === messageId);
  },

  getActiveEntries: (sessionId) =>
    get().sessionEntries.get(sessionId) ?? [],

  clearEntries: (sessionId) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      sessionEntries.set(sessionId, []);
      const sessionQuestions = new Map(state.sessionQuestions);
      sessionQuestions.set(sessionId, null);
      // Remove this session's items from the approval queue
      const approvalQueue = state.approvalQueue.filter(
        (a) => a.sessionId !== sessionId
      );
      const approvalSeenIds = new Set(state.approvalSeenIds);
      // Remove seen IDs for this session's approvals
      for (const a of state.approvalQueue) {
        if (a.sessionId === sessionId) {
          approvalSeenIds.delete(a.toolUseId);
        }
      }
      const currentApprovalIndex = Math.min(
        state.currentApprovalIndex,
        Math.max(0, approvalQueue.length - 1)
      );
      // Clear "always allow" decisions so /clear resets approval state
      const alwaysAllowedTools = new Map(state.alwaysAllowedTools);
      alwaysAllowedTools.delete(sessionId);
      return {
        sessionEntries,
        sessionQuestions,
        approvalQueue,
        approvalSeenIds,
        currentApprovalIndex,
        alwaysAllowedTools,
      };
    }),

  clearApprovalState: (sessionId) =>
    set((state) => {
      const sessionQuestions = new Map(state.sessionQuestions);
      sessionQuestions.set(sessionId, null);
      const approvalQueue = state.approvalQueue.filter(
        (a) => a.sessionId !== sessionId
      );
      const approvalSeenIds = new Set(state.approvalSeenIds);
      for (const a of state.approvalQueue) {
        if (a.sessionId === sessionId) {
          approvalSeenIds.delete(a.toolUseId);
        }
      }
      const currentApprovalIndex = Math.min(
        state.currentApprovalIndex,
        Math.max(0, approvalQueue.length - 1)
      );
      const alwaysAllowedTools = new Map(state.alwaysAllowedTools);
      alwaysAllowedTools.delete(sessionId);
      return {
        sessionQuestions,
        approvalQueue,
        approvalSeenIds,
        currentApprovalIndex,
        alwaysAllowedTools,
      };
    }),

  clearAllEntries: () =>
    set({
      sessionEntries: new Map(),
      sessionQuestions: new Map(),
      alwaysAllowedTools: new Map(),
      approvalQueue: [],
      approvalSeenIds: new Set<string>(),
      currentApprovalIndex: 0,
    }),
}));
