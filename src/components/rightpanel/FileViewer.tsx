import { useCallback, useState, useMemo, useEffect } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { X, FileText, WrapText, Columns2, Save } from "lucide-react";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { getMonacoTheme } from "../../lib/editor-themes";
import { writeFileContent } from "../../lib/tauri-commands";

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
  const isDirty = useFileViewerStore((s) => s.isDirty);
  const setEditedContent = useFileViewerStore((s) => s.setEditedContent);
  const markSaved = useFileViewerStore((s) => s.markSaved);
  const themeId = useSettingsStore((s) => s.settings.theme);
  const [wordWrap, setWordWrap] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);
  const [saving, setSaving] = useState(false);
  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);

  const handleSave = useCallback(async () => {
    if (!openFile || !isDirty) return;
    const content = useFileViewerStore.getState().editedContent;
    if (content == null) return;
    setSaving(true);
    try {
      await writeFileContent(openFile.filePath, content);
      markSaved();
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setSaving(false);
    }
  }, [openFile, isDirty, markSaved]);

  // Cmd+S keyboard shortcut for saving
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const isEditable = openFile ? !openFile.isDiff : false;

  const monacoOptions = useMemo(() => ({
    readOnly: !isEditable,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: "on" as const,
    scrollBeyondLastLine: false,
    wordWrap: wordWrap ? "on" as const : "off" as const,
    renderWhitespace: "none" as const,
    folding: true,
    automaticLayout: true,
    contextmenu: isEditable,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
  }), [wordWrap, isEditable]);

  const diffOptions = useMemo(() => ({
    ...monacoOptions,
    renderSideBySide: sideBySide,
    enableSplitViewResizing: false,
  }), [monacoOptions, sideBySide]);

  const diffSummary = useMemo(() => {
    if (!openFile?.isDiff || !openFile.oldContent || !openFile.newContent) return null;
    return computeDiffSummary(openFile.oldContent, openFile.newContent);
  }, [openFile]);

  const monacoThemeName = `claudeforge-${themeId}`;

  const handleEditorMount = useCallback(
    (_editor: unknown, monaco: { editor: { defineTheme: (name: string, theme: unknown) => void; setTheme: (name: string) => void } }) => {
      monaco.editor.defineTheme(monacoThemeName, {
        base: monacoColors.base,
        inherit: true,
        rules: [],
        colors: {
          "editor.background": monacoColors.editorBackground,
          "editor.lineHighlightBackground": monacoColors.lineHighlightBackground,
          "editorLineNumber.foreground": monacoColors.lineNumberForeground,
          "editorLineNumber.activeForeground": monacoColors.lineNumberActiveForeground,
          "editor.selectionBackground": monacoColors.selectionBackground,
          "editorWidget.background": monacoColors.widgetBackground,
          "editorWidget.border": monacoColors.widgetBorder,
          "diffEditor.insertedTextBackground": monacoColors.diffInsertedText,
          "diffEditor.removedTextBackground": monacoColors.diffRemovedText,
          "diffEditor.insertedLineBackground": monacoColors.diffInsertedLine,
          "diffEditor.removedLineBackground": monacoColors.diffRemovedLine,
        },
      });
      monaco.editor.setTheme(monacoThemeName);
    },
    [monacoColors, monacoThemeName]
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
          {openFile.fileName}{isDirty ? " •" : ""}
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
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              title="Save (⌘S)"
              className="p-1 rounded text-accent hover:bg-accent/10 transition-colors"
            >
              <Save size={13} />
            </button>
          )}
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
            theme={monacoThemeName}
            options={diffOptions}
            onMount={handleEditorMount}
          />
        ) : (
          <Editor
            value={openFile.content ?? ""}
            language={openFile.language}
            theme={monacoThemeName}
            options={monacoOptions}
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value !== undefined) {
                setEditedContent(value);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
