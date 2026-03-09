import { create } from "zustand";

export interface FileViewerTab {
  filePath: string;
  fileName: string;
  language: string;
  extension: string;
  fileSize: number;
  content: string | null;
  isDiff: boolean;
  oldContent?: string;
  newContent?: string;
}

interface FileViewerState {
  openFiles: FileViewerTab[];
  activeFilePath: string | null;
  editedContents: Map<string, string>;   // filePath → edited content
  dirtyFiles: Set<string>;               // filePaths with unsaved changes

  openFile: (tab: FileViewerTab) => void;      // Add or focus existing tab
  closeFile: (filePath: string) => void;       // Remove tab
  setActiveFile: (filePath: string) => void;   // Switch active tab
  setEditedContent: (filePath: string, content: string) => void;
  markSaved: (filePath: string) => void;
  closeAllFiles: () => void;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  rs: "rust",
  css: "css",
  html: "html",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  xml: "xml",
  svg: "xml",
  go: "go",
  java: "java",
  rb: "ruby",
  swift: "swift",
  kt: "kotlin",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
};

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
  editedContents: new Map(),
  dirtyFiles: new Set(),

  openFile: (tab) =>
    set((state) => {
      const existing = state.openFiles.findIndex((f) => f.filePath === tab.filePath);
      if (existing >= 0) {
        // Update tab data and set as active
        const openFiles = [...state.openFiles];
        openFiles[existing] = tab;
        return { openFiles, activeFilePath: tab.filePath };
      }
      // Append new tab and set as active
      return {
        openFiles: [...state.openFiles, tab],
        activeFilePath: tab.filePath,
      };
    }),

  closeFile: (filePath) =>
    set((state) => {
      const openFiles = state.openFiles.filter((f) => f.filePath !== filePath);
      const editedContents = new Map(state.editedContents);
      editedContents.delete(filePath);
      const dirtyFiles = new Set(state.dirtyFiles);
      dirtyFiles.delete(filePath);

      let activeFilePath = state.activeFilePath;
      if (activeFilePath === filePath) {
        activeFilePath = openFiles.length > 0 ? openFiles[openFiles.length - 1].filePath : null;
      }

      return { openFiles, activeFilePath, editedContents, dirtyFiles };
    }),

  setActiveFile: (filePath) => {
    const state = get();
    if (state.openFiles.some((f) => f.filePath === filePath)) {
      set({ activeFilePath: filePath });
    }
  },

  setEditedContent: (filePath, content) =>
    set((state) => {
      const editedContents = new Map(state.editedContents);
      editedContents.set(filePath, content);
      const dirtyFiles = new Set(state.dirtyFiles);
      const tab = state.openFiles.find((f) => f.filePath === filePath);
      if (tab && content !== (tab.content ?? "")) {
        dirtyFiles.add(filePath);
      } else {
        dirtyFiles.delete(filePath);
      }
      return { editedContents, dirtyFiles };
    }),

  markSaved: (filePath) =>
    set((state) => {
      const dirtyFiles = new Set(state.dirtyFiles);
      dirtyFiles.delete(filePath);
      const editedContents = new Map(state.editedContents);
      const savedContent = editedContents.get(filePath);
      // Update tab content to match saved content
      const openFiles = state.openFiles.map((f) =>
        f.filePath === filePath && savedContent !== undefined
          ? { ...f, content: savedContent }
          : f
      );
      return { dirtyFiles, openFiles, editedContents };
    }),

  closeAllFiles: () =>
    set({
      openFiles: [],
      activeFilePath: null,
      editedContents: new Map(),
      dirtyFiles: new Set(),
    }),
}));
