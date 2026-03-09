import { create } from "zustand";
import type { ChangelogEntry, ProjectChangelogEntry } from "../types/changelog";
import { getProjectChangelogEntries } from "../lib/tauri-commands";
import { useSessionStore } from "./sessionStore";

interface ChangelogState {
  sessionEntries: Map<string, ChangelogEntry[]>;
  generating: Map<string, boolean>;
  projectEntries: Map<string, ProjectChangelogEntry[]>;

  addEntry: (sessionId: string, entry: ChangelogEntry) => void;
  removeEntry: (sessionId: string, entryId: string) => void;
  setEntries: (sessionId: string, entries: ChangelogEntry[]) => void;
  setGenerating: (sessionId: string, generating: boolean) => void;
  clearSession: (sessionId: string) => void;
  loadProjectEntries: (projectPath: string) => Promise<void>;
}

export const useChangelogStore = create<ChangelogState>((set) => ({
  sessionEntries: new Map(),
  generating: new Map(),
  projectEntries: new Map(),

  addEntry: (sessionId, entry) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = [...(sessionEntries.get(sessionId) ?? []), entry];
      sessionEntries.set(sessionId, entries);

      // Also update projectEntries if loaded for this session's project
      const projectEntries = new Map(state.projectEntries);
      const session = useSessionStore.getState().sessions.get(sessionId);
      if (session?.project_path && projectEntries.has(session.project_path)) {
        const projectEntry: ProjectChangelogEntry = {
          ...entry,
          session_name: session.name,
        };
        const existing = projectEntries.get(session.project_path) ?? [];
        projectEntries.set(session.project_path, [projectEntry, ...existing]);
      }

      return { sessionEntries, projectEntries };
    }),

  removeEntry: (sessionId, entryId) =>
    set((state) => {
      const sessionEntries = new Map(state.sessionEntries);
      const entries = (sessionEntries.get(sessionId) ?? []).filter((e) => e.id !== entryId);
      sessionEntries.set(sessionId, entries);

      // Also remove from projectEntries if loaded
      const projectEntries = new Map(state.projectEntries);
      const session = useSessionStore.getState().sessions.get(sessionId);
      if (session?.project_path && projectEntries.has(session.project_path)) {
        const existing = projectEntries.get(session.project_path) ?? [];
        projectEntries.set(
          session.project_path,
          existing.filter((e) => e.id !== entryId)
        );
      }

      return { sessionEntries, projectEntries };
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

  loadProjectEntries: async (projectPath) => {
    const entries = await getProjectChangelogEntries(projectPath);
    set((state) => {
      const projectEntries = new Map(state.projectEntries);
      projectEntries.set(projectPath, entries);
      return { projectEntries };
    });
  },
}));
