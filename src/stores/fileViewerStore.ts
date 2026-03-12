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
  projectOpenFiles: Map<string, FileViewerTab[]>;          // projectPath → tabs
  projectActiveFile: Map<string, string | null>;           // projectPath → active file
  projectEditedContents: Map<string, Map<string, string>>; // projectPath → (filePath → content)
  projectDirtyFiles: Map<string, Set<string>>;             // projectPath → dirty set

  openFile: (projectPath: string, tab: FileViewerTab) => void;
  closeFile: (projectPath: string, filePath: string) => void;
  setActiveFile: (projectPath: string, filePath: string) => void;
  setEditedContent: (projectPath: string, filePath: string, content: string) => void;
  markSaved: (projectPath: string, filePath: string) => void;
  closeAllFiles: (projectPath: string) => void;
  clearProject: (projectPath: string) => void;
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
  projectOpenFiles: new Map(),
  projectActiveFile: new Map(),
  projectEditedContents: new Map(),
  projectDirtyFiles: new Map(),

  openFile: (projectPath, tab) =>
    set((state) => {
      const openFiles = [...(state.projectOpenFiles.get(projectPath) ?? [])];
      const existing = openFiles.findIndex((f) => f.filePath === tab.filePath);
      if (existing >= 0) {
        openFiles[existing] = tab;
      } else {
        openFiles.push(tab);
      }
      const projectOpenFiles = new Map(state.projectOpenFiles);
      projectOpenFiles.set(projectPath, openFiles);
      const projectActiveFile = new Map(state.projectActiveFile);
      projectActiveFile.set(projectPath, tab.filePath);
      return { projectOpenFiles, projectActiveFile };
    }),

  closeFile: (projectPath, filePath) =>
    set((state) => {
      const openFiles = (state.projectOpenFiles.get(projectPath) ?? []).filter(
        (f) => f.filePath !== filePath
      );
      const editedContents = new Map<string, string>(state.projectEditedContents.get(projectPath) ?? new Map());
      editedContents.delete(filePath);
      const dirtyFiles = new Set<string>(state.projectDirtyFiles.get(projectPath) ?? new Set());
      dirtyFiles.delete(filePath);

      let activeFilePath = state.projectActiveFile.get(projectPath) ?? null;
      if (activeFilePath === filePath) {
        activeFilePath = openFiles.length > 0 ? openFiles[openFiles.length - 1].filePath : null;
      }

      const projectOpenFiles = new Map(state.projectOpenFiles);
      projectOpenFiles.set(projectPath, openFiles);
      const projectActiveFile = new Map(state.projectActiveFile);
      projectActiveFile.set(projectPath, activeFilePath);
      const projectEditedContents = new Map(state.projectEditedContents);
      projectEditedContents.set(projectPath, editedContents);
      const projectDirtyFiles = new Map(state.projectDirtyFiles);
      projectDirtyFiles.set(projectPath, dirtyFiles);

      return { projectOpenFiles, projectActiveFile, projectEditedContents, projectDirtyFiles };
    }),

  setActiveFile: (projectPath, filePath) => {
    const state = get();
    const openFiles = state.projectOpenFiles.get(projectPath) ?? [];
    if (openFiles.some((f) => f.filePath === filePath)) {
      const projectActiveFile = new Map(state.projectActiveFile);
      projectActiveFile.set(projectPath, filePath);
      set({ projectActiveFile });
    }
  },

  setEditedContent: (projectPath, filePath, content) =>
    set((state) => {
      const editedContents = new Map<string, string>(state.projectEditedContents.get(projectPath) ?? new Map());
      editedContents.set(filePath, content);
      const dirtyFiles = new Set<string>(state.projectDirtyFiles.get(projectPath) ?? new Set());
      const openFiles = state.projectOpenFiles.get(projectPath) ?? [];
      const tab = openFiles.find((f) => f.filePath === filePath);
      if (tab && content !== (tab.content ?? "")) {
        dirtyFiles.add(filePath);
      } else {
        dirtyFiles.delete(filePath);
      }
      const projectEditedContents = new Map(state.projectEditedContents);
      projectEditedContents.set(projectPath, editedContents);
      const projectDirtyFiles = new Map(state.projectDirtyFiles);
      projectDirtyFiles.set(projectPath, dirtyFiles);
      return { projectEditedContents, projectDirtyFiles };
    }),

  markSaved: (projectPath, filePath) =>
    set((state) => {
      const dirtyFiles = new Set<string>(state.projectDirtyFiles.get(projectPath) ?? new Set());
      dirtyFiles.delete(filePath);
      const editedContents = new Map<string, string>(state.projectEditedContents.get(projectPath) ?? new Map());
      const savedContent = editedContents.get(filePath);
      const openFiles = (state.projectOpenFiles.get(projectPath) ?? []).map((f) =>
        f.filePath === filePath && savedContent !== undefined
          ? { ...f, content: savedContent }
          : f
      );

      const projectDirtyFiles = new Map(state.projectDirtyFiles);
      projectDirtyFiles.set(projectPath, dirtyFiles);
      const projectOpenFiles = new Map(state.projectOpenFiles);
      projectOpenFiles.set(projectPath, openFiles);
      const projectEditedContents = new Map(state.projectEditedContents);
      projectEditedContents.set(projectPath, editedContents);
      return { projectDirtyFiles, projectOpenFiles, projectEditedContents };
    }),

  closeAllFiles: (projectPath) =>
    set((state) => {
      const projectOpenFiles = new Map(state.projectOpenFiles);
      projectOpenFiles.set(projectPath, []);
      const projectActiveFile = new Map(state.projectActiveFile);
      projectActiveFile.set(projectPath, null);
      const projectEditedContents = new Map(state.projectEditedContents);
      projectEditedContents.set(projectPath, new Map());
      const projectDirtyFiles = new Map(state.projectDirtyFiles);
      projectDirtyFiles.set(projectPath, new Set());
      return { projectOpenFiles, projectActiveFile, projectEditedContents, projectDirtyFiles };
    }),

  clearProject: (projectPath) =>
    set((state) => {
      const projectOpenFiles = new Map(state.projectOpenFiles);
      projectOpenFiles.delete(projectPath);
      const projectActiveFile = new Map(state.projectActiveFile);
      projectActiveFile.delete(projectPath);
      const projectEditedContents = new Map(state.projectEditedContents);
      projectEditedContents.delete(projectPath);
      const projectDirtyFiles = new Map(state.projectDirtyFiles);
      projectDirtyFiles.delete(projectPath);
      return { projectOpenFiles, projectActiveFile, projectEditedContents, projectDirtyFiles };
    }),
}));
