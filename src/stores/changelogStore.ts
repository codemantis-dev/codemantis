import { create } from "zustand";
import type { ChangelogEntry } from "../types/changelog";

interface ChangelogState {
  sessionEntries: Map<string, ChangelogEntry[]>;
  generating: Map<string, boolean>;

  addEntry: (sessionId: string, entry: ChangelogEntry) => void;
  removeEntry: (sessionId: string, entryId: string) => void;
  setEntries: (sessionId: string, entries: ChangelogEntry[]) => void;
  setGenerating: (sessionId: string, generating: boolean) => void;
  clearSession: (sessionId: string) => void;
}

export const useChangelogStore = create<ChangelogState>((set) => ({
  sessionEntries: new Map(),
  generating: new Map(),

  addEntry: (sessionId, entry) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = [...(sessionEntries.get(sessionId) ?? []), entry];
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  removeEntry: (sessionId, entryId) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = (sessionEntries.get(sessionId) ?? []).filter((e) => e.id !== entryId);
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  setEntries: (sessionId, entries) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      sessionEntries.set(sessionId, entries);
      return { sessionEntries };
    }),

  setGenerating: (sessionId, generating) =>
    set((state) => {
      const gen = new Map(state.generating);
      gen.set(sessionId, generating);
      return { generating: gen };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      sessionEntries.delete(sessionId);
      const generating = new Map(state.generating);
      generating.delete(sessionId);
      return { sessionEntries, generating };
    }),
}));
