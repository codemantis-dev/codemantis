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
  openFile: FileViewerTab | null;
  editedContent: string | null;
  isDirty: boolean;

  setOpenFile: (tab: FileViewerTab) => void;
  closeFile: () => void;
  setEditedContent: (content: string) => void;
  markSaved: () => void;
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

export const useFileViewerStore = create<FileViewerState>((set) => ({
  openFile: null,
  editedContent: null,
  isDirty: false,

  setOpenFile: (tab) => set({ openFile: tab, editedContent: null, isDirty: false }),
  closeFile: () => set({ openFile: null, editedContent: null, isDirty: false }),
  setEditedContent: (content) =>
    set((state) => ({
      editedContent: content,
      isDirty: content !== (state.openFile?.content ?? ""),
    })),
  markSaved: () =>
    set((state) => ({
      isDirty: false,
      openFile: state.openFile
        ? { ...state.openFile, content: state.editedContent ?? state.openFile.content }
        : null,
    })),
}));
