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
  multiSelect: boolean;
  options: QuestionOption[];
}

export interface PendingQuestion {
  toolUseId: string;
  requestId: string;
  sessionId: string;
  question?: string;
  questions?: QuestionItem[];
}

interface ActivityState {
  sessionEntries: Map<string, ActivityEntry[]>;
  sessionQuestions: Map<string, PendingQuestion | null>;
  alwaysAllowedTools: Set<string>;

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
  addAlwaysAllowedTool: (toolName: string) => void;
  isToolAlwaysAllowed: (toolName: string) => boolean;
  getEntriesForMessage: (sessionId: string, messageId: string) => ActivityEntry[];
  getActiveEntries: (sessionId: string) => ActivityEntry[];
  clearEntries: (sessionId: string) => void;
  clearAllEntries: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  sessionEntries: new Map(),
  sessionQuestions: new Map(),
  alwaysAllowedTools: new Set<string>(),

  approvalQueue: [],
  approvalSeenIds: new Set<string>(),
  currentApprovalIndex: 0,

  addEntry: (sessionId, entry) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = [...(sessionEntries.get(sessionId) ?? []), entry];
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

  addAlwaysAllowedTool: (toolName) =>
    set((state) => {
      const updated = new Set(state.alwaysAllowedTools);
      updated.add(toolName);
      return { alwaysAllowedTools: updated };
    }),

  isToolAlwaysAllowed: (toolName) => get().alwaysAllowedTools.has(toolName),

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
      return {
        sessionEntries,
        sessionQuestions,
        approvalQueue,
        approvalSeenIds,
        currentApprovalIndex,
      };
    }),

  clearAllEntries: () =>
    set({
      sessionEntries: new Map(),
      sessionQuestions: new Map(),
      approvalQueue: [],
      approvalSeenIds: new Set<string>(),
      currentApprovalIndex: 0,
    }),
}));
