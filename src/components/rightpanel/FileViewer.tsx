import { useCallback, useState, useMemo, useEffect } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { X, FileText, WrapText, Columns2, Save } from "lucide-react";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { getMonacoTheme } from "../../lib/editor-themes";
import { writeFileContent } from "../../lib/tauri-commands";

// Stable empty defaults to avoid re-render loops from zustand selectors
const EMPTY_TABS: import("../../stores/fileViewerStore").FileViewerTab[] = [];
const EMPTY_DIRTY = new Set<string>();
const EMPTY_EDITED = new Map<string, string>();

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
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const pp = activeProjectPath ?? "";

  const openFiles = useFileViewerStore((s) => s.projectOpenFiles.get(pp) ?? EMPTY_TABS);
  const activeFilePath = useFileViewerStore((s) => s.projectActiveFile.get(pp) ?? null);
  const dirtyFiles = useFileViewerStore((s) => s.projectDirtyFiles.get(pp) ?? EMPTY_DIRTY);
  const editedContents = useFileViewerStore((s) => s.projectEditedContents.get(pp) ?? EMPTY_EDITED);
  const storeCloseFile = useFileViewerStore((s) => s.closeFile);
  const storeSetActiveFile = useFileViewerStore((s) => s.setActiveFile);
  const storeSetEditedContent = useFileViewerStore((s) => s.setEditedContent);
  const storeMarkSaved = useFileViewerStore((s) => s.markSaved);
  const themeId = useSettingsStore((s) => s.settings.theme);
  const [wordWrap, setWordWrap] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);
  const [saving, setSaving] = useState(false);
  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);

  const closeFile = useCallback((filePath: string) => storeCloseFile(pp, filePath), [pp, storeCloseFile]);
  const setActiveFile = useCallback((filePath: string) => storeSetActiveFile(pp, filePath), [pp, storeSetActiveFile]);
  const setEditedContent = useCallback((filePath: string, content: string) => storeSetEditedContent(pp, filePath, content), [pp, storeSetEditedContent]);
  const markSaved = useCallback((filePath: string) => storeMarkSaved(pp, filePath), [pp, storeMarkSaved]);

  const activeTab = useMemo(
    () => openFiles.find((f) => f.filePath === activeFilePath) ?? null,
    [openFiles, activeFilePath]
  );

  const isDirty = activeFilePath ? dirtyFiles.has(activeFilePath) : false;

  const handleSave = useCallback(async () => {
    if (!activeFilePath || !isDirty) return;
    const content = useFileViewerStore.getState().projectEditedContents.get(pp)?.get(activeFilePath);
    if (content == null) return;
    setSaving(true);
    try {
      await writeFileContent(activeFilePath, content);
      markSaved(activeFilePath);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setSaving(false);
    }
  }, [activeFilePath, isDirty, markSaved, pp]);

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

  const isEditable = activeTab ? !activeTab.isDiff : false;

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
    if (!activeTab?.isDiff || !activeTab.oldContent || !activeTab.newContent) return null;
    return computeDiffSummary(activeTab.oldContent, activeTab.newContent);
  }, [activeTab]);

  const monacoThemeName = `codemantis-${themeId}`;

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

  const editorValue = activeFilePath
    ? editedContents.get(activeFilePath) ?? activeTab?.content ?? ""
    : "";

  if (openFiles.length === 0) {
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
      {/* Tab bar */}
      <div className="flex items-center h-7 border-b border-border-light px-1 gap-0.5 shrink-0 overflow-x-auto">
        {openFiles.map((tab) => {
          const isActive = tab.filePath === activeFilePath;
          const tabDirty = dirtyFiles.has(tab.filePath);
          return (
            <button
              key={tab.filePath}
              onClick={() => setActiveFile(tab.filePath)}
              className={`
                flex items-center gap-1 px-2 h-6 rounded text-label transition-colors group shrink-0
                ${isActive
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle"
                }
              `}
              title={tab.filePath}
            >
              <span className="truncate max-w-[120px]">
                {tab.fileName}{tabDirty ? " \u2022" : ""}
              </span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(tab.filePath);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-subtle transition-all"
              >
                <X size={10} />
              </span>
            </button>
          );
        })}
      </div>

      {/* File header with toolbar */}
      {activeTab && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-light shrink-0">
          <FileText size={13} className="text-text-dim shrink-0" />
          <span className="text-ui text-text-primary font-medium truncate">
            {activeTab.fileName}{isDirty ? " \u2022" : ""}
          </span>
          {activeTab.extension && (
            <span className="text-label px-1.5 py-0.5 rounded bg-bg-elevated text-text-dim shrink-0">
              .{activeTab.extension}
            </span>
          )}
          {activeTab.isDiff && diffSummary && (
            <span className="text-label shrink-0">
              <span className="text-green">+{diffSummary.added}</span>
              {" "}
              <span className="text-red">-{diffSummary.removed}</span>
            </span>
          )}
          {!activeTab.isDiff && activeTab.fileSize > 0 && (
            <span className="text-label text-text-ghost shrink-0">
              {formatFileSize(activeTab.fileSize)}
            </span>
          )}

          {/* Toolbar */}
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            {isDirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                title="Save (\u2318S)"
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
            {activeTab.isDiff && (
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
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeTab?.isDiff && activeTab.oldContent !== undefined && activeTab.newContent !== undefined ? (
          <DiffEditor
            original={activeTab.oldContent}
            modified={activeTab.newContent}
            language={activeTab.language}
            theme={monacoThemeName}
            options={diffOptions}
            onMount={handleEditorMount}
          />
        ) : (
          <Editor
            key={activeFilePath ?? "empty"}
            value={editorValue}
            language={activeTab?.language ?? "plaintext"}
            theme={monacoThemeName}
            options={monacoOptions}
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value !== undefined && activeFilePath) {
                setEditedContent(activeFilePath, value);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
