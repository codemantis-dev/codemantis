import { useCallback, useState, useMemo } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { X, FileText, WrapText, Columns2 } from "lucide-react";
import { useFileViewerStore } from "../../stores/fileViewerStore";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeDiffSummary(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  let added = 0;
  let removed = 0;
  for (const line of newLines) {
    if (!oldSet.has(line)) added++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) removed++;
  }
  return { added, removed };
}

export default function FileViewer() {
  const openFile = useFileViewerStore((s) => s.openFile);
  const closeFile = useFileViewerStore((s) => s.closeFile);
  const [wordWrap, setWordWrap] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);

  const monacoOptions = useMemo(() => ({
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: "on" as const,
    scrollBeyondLastLine: false,
    wordWrap: wordWrap ? "on" as const : "off" as const,
    renderWhitespace: "none" as const,
    folding: true,
    automaticLayout: true,
    contextmenu: false,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
  }), [wordWrap]);

  const diffOptions = useMemo(() => ({
    ...monacoOptions,
    renderSideBySide: sideBySide,
    enableSplitViewResizing: false,
  }), [monacoOptions, sideBySide]);

  const diffSummary = useMemo(() => {
    if (!openFile?.isDiff || !openFile.oldContent || !openFile.newContent) return null;
    return computeDiffSummary(openFile.oldContent, openFile.newContent);
  }, [openFile]);

  const handleEditorMount = useCallback(
    (_editor: unknown, monaco: { editor: { defineTheme: (name: string, theme: unknown) => void; setTheme: (name: string) => void } }) => {
      monaco.editor.defineTheme("claudeforge-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#0a0a0c",
          "editor.lineHighlightBackground": "#ffffff08",
          "editorLineNumber.foreground": "#52525b",
          "editorLineNumber.activeForeground": "#a1a1aa",
          "editor.selectionBackground": "#7c3aed40",
          "editorWidget.background": "#18181b",
          "editorWidget.border": "#ffffff12",
          "diffEditor.insertedTextBackground": "#4ade8018",
          "diffEditor.removedTextBackground": "#f8717118",
          "diffEditor.insertedLineBackground": "#4ade800a",
          "diffEditor.removedLineBackground": "#f871710a",
        },
      });
      monaco.editor.setTheme("claudeforge-dark");
    },
    []
  );

  if (!openFile) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <FileText size={24} className="text-text-ghost" />
        <p className="text-text-faint text-ui">No file open</p>
        <p className="text-text-ghost text-label">Click a file in the sidebar or activity feed</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light shrink-0">
        <FileText size={13} className="text-text-dim shrink-0" />
        <span className="text-ui text-text-primary font-medium truncate">
          {openFile.fileName}
        </span>
        {openFile.extension && (
          <span className="text-label px-1.5 py-0.5 rounded bg-bg-elevated text-text-dim shrink-0">
            .{openFile.extension}
          </span>
        )}
        {openFile.isDiff && diffSummary && (
          <span className="text-label shrink-0">
            <span className="text-green">+{diffSummary.added}</span>
            {" "}
            <span className="text-red">-{diffSummary.removed}</span>
          </span>
        )}
        {!openFile.isDiff && openFile.fileSize > 0 && (
          <span className="text-label text-text-ghost shrink-0">
            {formatFileSize(openFile.fileSize)}
          </span>
        )}

        {/* Toolbar */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
            className={`p-1 rounded transition-colors ${
              wordWrap ? "text-accent bg-accent/10" : "text-text-faint hover:text-text-secondary"
            }`}
          >
            <WrapText size={13} />
          </button>
          {openFile.isDiff && (
            <button
              onClick={() => setSideBySide(!sideBySide)}
              title={sideBySide ? "Unified view" : "Side-by-side view"}
              className={`p-1 rounded transition-colors ${
                sideBySide ? "text-accent bg-accent/10" : "text-text-faint hover:text-text-secondary"
              }`}
            >
              <Columns2 size={13} />
            </button>
          )}
          <button
            onClick={closeFile}
            className="p-1 rounded hover:bg-bg-elevated text-text-faint hover:text-text-secondary transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {openFile.isDiff && openFile.oldContent !== undefined && openFile.newContent !== undefined ? (
          <DiffEditor
            original={openFile.oldContent}
            modified={openFile.newContent}
            language={openFile.language}
            theme="claudeforge-dark"
            options={diffOptions}
            onMount={handleEditorMount}
          />
        ) : (
          <Editor
            value={openFile.content ?? ""}
            language={openFile.language}
            theme="claudeforge-dark"
            options={monacoOptions}
            onMount={handleEditorMount}
          />
        )}
      </div>
    </div>
  );
}
