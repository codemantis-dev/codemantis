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
  /** 1-based line to scroll to when the tab opens (from a `path:line` citation). */
  gotoLine?: number;
}

interface FileViewerState {
  sessionOpenFiles: Map<string, FileViewerTab[]>;          // sessionId → tabs
  sessionActiveFile: Map<string, string | null>;           // sessionId → active file
  sessionEditedContents: Map<string, Map<string, string>>; // sessionId → (filePath → content)
  sessionDirtyFiles: Map<string, Set<string>>;             // sessionId → dirty set

  openFile: (sessionId: string, tab: FileViewerTab) => void;
  closeFile: (sessionId: string, filePath: string) => void;
  setActiveFile: (sessionId: string, filePath: string) => void;
  setEditedContent: (sessionId: string, filePath: string, content: string) => void;
  markSaved: (sessionId: string, filePath: string) => void;
  toggleFileDiff: (sessionId: string, filePath: string) => void;
  closeAllFiles: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
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
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
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
  env: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  r: "r",
  lua: "lua",
  php: "php",
  pl: "perl",
  tf: "hcl",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  dart: "dart",
  dockerfile: "dockerfile",
};

/** Map exact filenames (lowercased) to Monaco language IDs */
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  ".gitignore": "ini",
  ".dockerignore": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
  ".nvmrc": "plaintext",
};

export function getLanguageFromPath(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";

  // Check exact filename matches first (Dockerfile, Makefile, etc.)
  const byName = FILENAME_TO_LANGUAGE[fileName];
  if (byName) return byName;

  // .env files: .env, .env.local, .env.development, .env.production, etc.
  if (fileName === ".env" || fileName.startsWith(".env.")) return "ini";

  const ext = fileName.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

export const useFileViewerStore = create<FileViewerState>((set, get) => ({
  sessionOpenFiles: new Map(),
  sessionActiveFile: new Map(),
  sessionEditedContents: new Map(),
  sessionDirtyFiles: new Map(),

  openFile: (sessionId, tab) =>
    set((state) => {
      const openFiles = [...(state.sessionOpenFiles.get(sessionId) ?? [])];
      const existing = openFiles.findIndex((f) => f.filePath === tab.filePath);
      if (existing >= 0) {
        openFiles[existing] = tab;
      } else {
        openFiles.push(tab);
      }
      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.set(sessionId, openFiles);
      const sessionActiveFile = new Map(state.sessionActiveFile);
      sessionActiveFile.set(sessionId, tab.filePath);
      return { sessionOpenFiles, sessionActiveFile };
    }),

  closeFile: (sessionId, filePath) =>
    set((state) => {
      const openFiles = (state.sessionOpenFiles.get(sessionId) ?? []).filter(
        (f) => f.filePath !== filePath
      );
      const editedContents = new Map<string, string>(state.sessionEditedContents.get(sessionId) ?? new Map());
      editedContents.delete(filePath);
      const dirtyFiles = new Set<string>(state.sessionDirtyFiles.get(sessionId) ?? new Set());
      dirtyFiles.delete(filePath);

      let activeFilePath = state.sessionActiveFile.get(sessionId) ?? null;
      if (activeFilePath === filePath) {
        activeFilePath = openFiles.length > 0 ? openFiles[openFiles.length - 1].filePath : null;
      }

      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.set(sessionId, openFiles);
      const sessionActiveFile = new Map(state.sessionActiveFile);
      sessionActiveFile.set(sessionId, activeFilePath);
      const sessionEditedContents = new Map(state.sessionEditedContents);
      sessionEditedContents.set(sessionId, editedContents);
      const sessionDirtyFiles = new Map(state.sessionDirtyFiles);
      sessionDirtyFiles.set(sessionId, dirtyFiles);

      return { sessionOpenFiles, sessionActiveFile, sessionEditedContents, sessionDirtyFiles };
    }),

  setActiveFile: (sessionId, filePath) => {
    const state = get();
    const openFiles = state.sessionOpenFiles.get(sessionId) ?? [];
    if (openFiles.some((f) => f.filePath === filePath)) {
      const sessionActiveFile = new Map(state.sessionActiveFile);
      sessionActiveFile.set(sessionId, filePath);
      set({ sessionActiveFile });
    }
  },

  setEditedContent: (sessionId, filePath, content) =>
    set((state) => {
      const editedContents = new Map<string, string>(state.sessionEditedContents.get(sessionId) ?? new Map());
      editedContents.set(filePath, content);
      const dirtyFiles = new Set<string>(state.sessionDirtyFiles.get(sessionId) ?? new Set());
      const openFiles = state.sessionOpenFiles.get(sessionId) ?? [];
      const tab = openFiles.find((f) => f.filePath === filePath);
      if (tab && content !== (tab.content ?? "")) {
        dirtyFiles.add(filePath);
      } else {
        dirtyFiles.delete(filePath);
      }
      const sessionEditedContents = new Map(state.sessionEditedContents);
      sessionEditedContents.set(sessionId, editedContents);
      const sessionDirtyFiles = new Map(state.sessionDirtyFiles);
      sessionDirtyFiles.set(sessionId, dirtyFiles);
      return { sessionEditedContents, sessionDirtyFiles };
    }),

  markSaved: (sessionId, filePath) =>
    set((state) => {
      const dirtyFiles = new Set<string>(state.sessionDirtyFiles.get(sessionId) ?? new Set());
      dirtyFiles.delete(filePath);
      const editedContents = new Map<string, string>(state.sessionEditedContents.get(sessionId) ?? new Map());
      const savedContent = editedContents.get(filePath);
      const openFiles = (state.sessionOpenFiles.get(sessionId) ?? []).map((f) =>
        f.filePath === filePath && savedContent !== undefined
          ? { ...f, content: savedContent }
          : f
      );

      const sessionDirtyFiles = new Map(state.sessionDirtyFiles);
      sessionDirtyFiles.set(sessionId, dirtyFiles);
      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.set(sessionId, openFiles);
      const sessionEditedContents = new Map(state.sessionEditedContents);
      sessionEditedContents.set(sessionId, editedContents);
      return { sessionDirtyFiles, sessionOpenFiles, sessionEditedContents };
    }),

  toggleFileDiff: (sessionId, filePath) =>
    set((state) => {
      const openFiles = (state.sessionOpenFiles.get(sessionId) ?? []).map((f) => {
        if (f.filePath !== filePath) return f;
        if (f.isDiff) {
          // Diff → Normal: show the new content as regular view
          return { ...f, isDiff: false, content: f.newContent ?? f.content };
        } else if (f.oldContent !== undefined && f.newContent !== undefined) {
          // Normal → Diff: switch back to diff view
          return { ...f, isDiff: true };
        }
        return f;
      });
      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.set(sessionId, openFiles);
      return { sessionOpenFiles };
    }),

  closeAllFiles: (sessionId) =>
    set((state) => {
      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.set(sessionId, []);
      const sessionActiveFile = new Map(state.sessionActiveFile);
      sessionActiveFile.set(sessionId, null);
      const sessionEditedContents = new Map(state.sessionEditedContents);
      sessionEditedContents.set(sessionId, new Map());
      const sessionDirtyFiles = new Map(state.sessionDirtyFiles);
      sessionDirtyFiles.set(sessionId, new Set());
      return { sessionOpenFiles, sessionActiveFile, sessionEditedContents, sessionDirtyFiles };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const sessionOpenFiles = new Map(state.sessionOpenFiles);
      sessionOpenFiles.delete(sessionId);
      const sessionActiveFile = new Map(state.sessionActiveFile);
      sessionActiveFile.delete(sessionId);
      const sessionEditedContents = new Map(state.sessionEditedContents);
      sessionEditedContents.delete(sessionId);
      const sessionDirtyFiles = new Map(state.sessionDirtyFiles);
      sessionDirtyFiles.delete(sessionId);
      return { sessionOpenFiles, sessionActiveFile, sessionEditedContents, sessionDirtyFiles };
    }),
}));
