import { create } from "zustand";
import type { ActivityEntry } from "../types/activity";

interface ActivityState {
  entries: ActivityEntry[];
  pendingApproval: {
    toolUseId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  } | null;

  addEntry: (entry: ActivityEntry) => void;
  updateEntryStatus: (
    toolUseId: string,
    status: ActivityEntry["status"],
    result?: string,
    isError?: boolean
  ) => void;
  setPendingApproval: (
    approval: {
      toolUseId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
    } | null
  ) => void;
  getEntriesForMessage: (messageId: string) => ActivityEntry[];
  clearEntries: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: [],
  pendingApproval: null,

  addEntry: (entry) =>
    set((state) => ({ entries: [...state.entries, entry] })),

  updateEntryStatus: (toolUseId, status, result, isError) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.toolUseId === toolUseId
          ? { ...e, status, result: result ?? e.result, isError: isError ?? e.isError }
          : e
      ),
    })),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  getEntriesForMessage: (messageId) =>
    get().entries.filter((e) => e.messageId === messageId),

  clearEntries: () => set({ entries: [], pendingApproval: null }),
}));
