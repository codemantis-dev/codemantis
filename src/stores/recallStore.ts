/**
 * Per-project Recall sidebar state.
 *
 * Pure UI cache: every field here is rederivable from the recall_*
 * Tauri commands. The store is keyed by project_path so navigating
 * between projects doesn't lose the per-project history.
 *
 * `loadingByProject` is the in-flight flag the sidebar uses to render
 * a spinner while `refresh()` is fetching. Settings panel + sidebar
 * both call `refresh()` after operations that mutate vault state
 * (reindex, force-seed) so the UI catches up.
 */

import { create } from "zustand";

import type {
  RecallEnrichmentRow,
  RecallHarvestRow,
  RecallHealth,
  RecallIndexedNote,
} from "../types/recall";

interface RecallProjectState {
  health: RecallHealth | null;
  enrichments: RecallEnrichmentRow[];
  harvests: RecallHarvestRow[];
  /** Last-fetch timestamp in ms-since-epoch. */
  fetchedAt: number;
}

interface RecallState {
  byProject: Map<string, RecallProjectState>;
  loadingByProject: Map<string, boolean>;
  /** Notes returned by the last `recall_get_notes_for_paths` call,
   *  used by Spec preview UI. Keyed by project_path. */
  notesForPaths: Map<string, RecallIndexedNote[]>;

  setProject: (projectPath: string, state: Partial<RecallProjectState>) => void;
  setLoading: (projectPath: string, loading: boolean) => void;
  setNotesForPaths: (projectPath: string, notes: RecallIndexedNote[]) => void;
  clearProject: (projectPath: string) => void;
}

const emptyState = (): RecallProjectState => ({
  health: null,
  enrichments: [],
  harvests: [],
  fetchedAt: 0,
});

export const useRecallStore = create<RecallState>((set) => ({
  byProject: new Map(),
  loadingByProject: new Map(),
  notesForPaths: new Map(),

  setProject: (projectPath, partial) =>
    set((s) => {
      const next = new Map(s.byProject);
      const existing = next.get(projectPath) ?? emptyState();
      next.set(projectPath, {
        ...existing,
        ...partial,
        fetchedAt: Date.now(),
      });
      return { byProject: next };
    }),

  setLoading: (projectPath, loading) =>
    set((s) => {
      const next = new Map(s.loadingByProject);
      if (loading) {
        next.set(projectPath, true);
      } else {
        next.delete(projectPath);
      }
      return { loadingByProject: next };
    }),

  setNotesForPaths: (projectPath, notes) =>
    set((s) => {
      const next = new Map(s.notesForPaths);
      next.set(projectPath, notes);
      return { notesForPaths: next };
    }),

  clearProject: (projectPath) =>
    set((s) => {
      const byProject = new Map(s.byProject);
      const loading = new Map(s.loadingByProject);
      const notes = new Map(s.notesForPaths);
      byProject.delete(projectPath);
      loading.delete(projectPath);
      notes.delete(projectPath);
      return { byProject, loadingByProject: loading, notesForPaths: notes };
    }),
}));
