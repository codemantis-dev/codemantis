import { create } from "zustand";
import type { DevServerState, ConsoleLogEntry, ViewportPreset } from "../types/preview";

export interface PreviewUrlPrompt {
  projectPath: string;
  errorMessage: string;
}

interface PreviewState {
  devServer: Map<string, DevServerState>;
  previewOpen: Map<string, boolean>;
  consoleLogs: Map<string, ConsoleLogEntry[]>;
  consoleDrawerOpen: boolean;
  viewportPreset: ViewportPreset;
  unreadErrors: Map<string, number>;
  previewUrlPrompt: PreviewUrlPrompt | null;

  setDevServer: (projectPath: string, partial: Partial<DevServerState>) => void;
  clearDevServer: (projectPath: string) => void;
  setPreviewOpen: (projectPath: string, open: boolean) => void;
  addConsoleLog: (projectPath: string, entry: ConsoleLogEntry) => void;
  clearConsoleLogs: (projectPath: string) => void;
  setViewportPreset: (preset: ViewportPreset) => void;
  toggleConsoleDrawer: () => void;
  resetUnreadErrors: (projectPath: string) => void;
  setPreviewUrlPrompt: (prompt: PreviewUrlPrompt | null) => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  devServer: new Map(),
  previewOpen: new Map(),
  consoleLogs: new Map(),
  consoleDrawerOpen: false,
  viewportPreset: "desktop",
  unreadErrors: new Map(),

  setDevServer: (projectPath, partial) =>
    set((state) => {
      const devServer = new Map(state.devServer);
      const existing = devServer.get(projectPath);
      devServer.set(projectPath, { ...existing, ...partial } as DevServerState);
      return { devServer };
    }),

  clearDevServer: (projectPath) =>
    set((state) => {
      const devServer = new Map(state.devServer);
      devServer.delete(projectPath);
      return { devServer };
    }),

  setPreviewOpen: (projectPath, open) =>
    set((state) => {
      const previewOpen = new Map(state.previewOpen);
      previewOpen.set(projectPath, open);
      return { previewOpen };
    }),

  addConsoleLog: (projectPath, entry) =>
    set((state) => {
      const consoleLogs = new Map(state.consoleLogs);
      const logs = [...(consoleLogs.get(projectPath) ?? []), entry];
      // Cap at 500 entries
      consoleLogs.set(projectPath, logs.slice(-500));
      const unreadErrors = new Map(state.unreadErrors);
      if (entry.level === "error") {
        unreadErrors.set(projectPath, (unreadErrors.get(projectPath) ?? 0) + 1);
      }
      return { consoleLogs, unreadErrors };
    }),

  clearConsoleLogs: (projectPath) =>
    set((state) => {
      const consoleLogs = new Map(state.consoleLogs);
      consoleLogs.set(projectPath, []);
      const unreadErrors = new Map(state.unreadErrors);
      unreadErrors.set(projectPath, 0);
      return { consoleLogs, unreadErrors };
    }),

  setViewportPreset: (preset) => set({ viewportPreset: preset }),

  toggleConsoleDrawer: () =>
    set((state) => ({ consoleDrawerOpen: !state.consoleDrawerOpen })),

  resetUnreadErrors: (projectPath) =>
    set((state) => {
      const unreadErrors = new Map(state.unreadErrors);
      unreadErrors.set(projectPath, 0);
      return { unreadErrors };
    }),

  previewUrlPrompt: null,
  setPreviewUrlPrompt: (prompt) => set({ previewUrlPrompt: prompt }),
}));
