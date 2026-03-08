import { create } from "zustand";
import type { ActivityEntry } from "../types/activity";

interface PendingApproval {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface QuestionOption {
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
  question?: string;
  questions?: QuestionItem[];
}

interface ActivityState {
  sessionEntries: Map<string, ActivityEntry[]>;
  sessionApprovals: Map<string, PendingApproval | null>;
  sessionQuestions: Map<string, PendingQuestion | null>;
  alwaysAllowedTools: Set<string>;

  addEntry: (sessionId: string, entry: ActivityEntry) => void;
  updateEntryStatus: (
    sessionId: string,
    toolUseId: string,
    status: ActivityEntry["status"],
    result?: string,
    isError?: boolean
  ) => void;
  setPendingApproval: (
    sessionId: string,
    approval: PendingApproval | null
  ) => void;
  setPendingQuestion: (
    sessionId: string,
    question: PendingQuestion | null
  ) => void;
  addAlwaysAllowedTool: (toolName: string) => void;
  isToolAlwaysAllowed: (toolName: string) => boolean;
  getEntriesForMessage: (sessionId: string, messageId: string) => ActivityEntry[];
  getActiveEntries: (sessionId: string) => ActivityEntry[];
  getActivePendingApproval: (sessionId: string) => PendingApproval | null;
  clearEntries: (sessionId: string) => void;
  clearAllEntries: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  sessionEntries: new Map(),
  sessionApprovals: new Map(),
  sessionQuestions: new Map(),
  alwaysAllowedTools: new Set<string>(),

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

  setPendingApproval: (sessionId, approval) =>
    set((state) => {
      const sessionApprovals = new Map(state.sessionApprovals);
      sessionApprovals.set(sessionId, approval);
      return { sessionApprovals };
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

  getActivePendingApproval: (sessionId) =>
    get().sessionApprovals.get(sessionId) ?? null,

  clearEntries: (sessionId) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      sessionEntries.set(sessionId, []);
      const sessionApprovals = new Map(state.sessionApprovals);
      sessionApprovals.set(sessionId, null);
      const sessionQuestions = new Map(state.sessionQuestions);
      sessionQuestions.set(sessionId, null);
      return { sessionEntries, sessionApprovals, sessionQuestions };
    }),

  clearAllEntries: () =>
    set({
      sessionEntries: new Map(),
      sessionApprovals: new Map(),
      sessionQuestions: new Map(),
    }),
}));
