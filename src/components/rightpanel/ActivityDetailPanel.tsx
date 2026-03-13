import { useEffect, useMemo, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useFileViewerStore, getLanguageFromPath } from "../../stores/fileViewerStore";
import { getActivityType } from "../../types/activity";
import { getMonacoTheme } from "../../lib/editor-themes";
import { readFileContent } from "../../lib/tauri-commands";
import ToolBadge from "../shared/ToolBadge";
import StatusDot from "../shared/StatusDot";

const typeColors: Record<string, "blue" | "green" | "yellow" | "purple" | "accent"> = {
  read: "blue",
  write: "green",
  edit: "yellow",
  bash: "purple",
  task: "blue",
  search: "purple",
  agent: "green",
  question: "accent",
  mcp: "purple",
  other: "accent",
};

/** Format MCP tool names: mcp__server__tool → "server: tool" */
function getToolDisplayName(toolName: string): string {
  if (toolName === "AskUserQuestion") return "User Question";
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const server = parts[1] ?? "mcp";
    const tool = parts.slice(2).join("_") || "tool";
    return `${server}: ${tool}`;
  }
  return toolName;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export default function ActivityDetailPanel() {
  const entry = useUiStore((s) => s.selectedActivityEntry);
  const setEntry = useUiStore((s) => s.setSelectedActivityEntry);
  const themeId = useSettingsStore((s) => s.settings.theme);

  const dismiss = useCallback(() => setEntry(null), [setEntry]);

  // Escape key dismisses
  useEffect(() => {
    if (!entry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [entry, dismiss]);

  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);
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

  const diffOptions = useMemo(() => ({
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: "on" as const,
    scrollBeyondLastLine: false,
    wordWrap: "on" as const,
    renderWhitespace: "none" as const,
    renderSideBySide: false,
    automaticLayout: true,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
  }), []);

  if (!entry) return null;

  const activityType = getActivityType(entry.toolName);
  const color = typeColors[activityType] ?? "accent";
  const filePath = entry.toolInput.file_path as string | undefined;
  const oldString = entry.toolInput.old_string as string | undefined;
  const newString = entry.toolInput.new_string as string | undefined;
  const writeContent = entry.toolInput.content as string | undefined;
  const language = filePath ? getLanguageFromPath(filePath) : "plaintext";

  const isEdit = activityType === "edit" && oldString !== undefined && newString !== undefined;
  const isWrite = activityType === "write" && writeContent !== undefined;

  // Input fields to display (excluding large content fields shown separately)
  const inputEntries = Object.entries(entry.toolInput).filter(
    ([key]) => !["old_string", "new_string", "content"].includes(key)
  );

  const handleOpenInFileViewer = () => {
    if (!filePath) return;

    // Capture values before dismiss unmounts the component
    const fp = filePath;
    const edit = isEdit;
    const os = oldString;
    const ns = newString;

    // Dismiss first so the panel cleanly unmounts before tab switch
    dismiss();

    // Then open in file viewer via direct store access (safe after unmount)
    const projectPath = useSessionStore.getState().activeProjectPath;
    if (!projectPath) return;

    const fileName = fp.split("/").pop() ?? fp;
    const lang = getLanguageFromPath(fp);
    const ext = fp.split(".").pop()?.toLowerCase() ?? "";

    if (edit && os !== undefined && ns !== undefined) {
      useFileViewerStore.getState().openFile(projectPath, {
        filePath: fp,
        fileName,
        language: lang,
        extension: ext,
        fileSize: new Blob([ns]).size,
        content: null,
        isDiff: true,
        oldContent: os,
        newContent: ns,
      });
      useUiStore.getState().setRightTab("files");
    } else {
      // Async file read — fire and forget safely
      readFileContent(fp).then((content) => {
        useFileViewerStore.getState().openFile(projectPath, {
          filePath: fp,
          fileName,
          language: lang,
          extension: ext,
          fileSize: new Blob([content]).size,
          content,
          isDiff: false,
        });
        useUiStore.getState().setRightTab("files");
      }).catch((e) => {
        console.error("Failed to open file:", e);
      });
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col animate-detail-slide-in"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-light shrink-0">
        <button
          onClick={dismiss}
          className="p-1 rounded text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
          title="Back (Escape)"
        >
          <ArrowLeft size={14} />
        </button>
        <ToolBadge toolName={entry.toolName} />
        <span className="text-ui text-text-primary font-medium truncate">
          {getToolDisplayName(entry.toolName)}
        </span>
        <StatusDot
          color={entry.status === "error" ? "red" : color}
          pulse={entry.status === "running"}
          size={6}
        />
        {entry.durationMs !== undefined && (
          <span className="text-label text-text-ghost">
            {formatDuration(entry.durationMs)}
          </span>
        )}
        <span className="text-label text-text-ghost ml-auto shrink-0">
          {new Date(entry.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>

      {/* Body (scrollable) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3 select-text">
        {/* Input section */}
        {inputEntries.length > 0 && (
          <section>
            <h3 className="text-label text-text-ghost font-medium uppercase tracking-wider mb-1.5">
              Input
            </h3>
            <div className="rounded-lg border border-border-light overflow-hidden" style={{ background: "var(--bg-primary)" }}>
              {inputEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 px-3 py-1.5 border-b border-border-light last:border-b-0 min-w-0">
                  <span className="text-label text-text-ghost shrink-0 w-20 font-mono">{key}</span>
                  <span
                    className={`text-label text-text-secondary break-all min-w-0 ${
                      key === "command" || key === "pattern" || key === "regex" ? "font-mono" : ""
                    }`}
                  >
                    {typeof value === "string" ? value : String(value === undefined ? "" : JSON.stringify(value))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Diff section (Edit tool) */}
        {isEdit && (
          <section>
            <h3 className="text-label text-text-ghost font-medium uppercase tracking-wider mb-1.5">
              Changes
            </h3>
            <div
              className="rounded-lg border border-border-light overflow-hidden"
              style={{ height: Math.min(300, Math.max(100, (oldString.split("\n").length + newString.split("\n").length) * 19 + 20)) }}
            >
              <DiffEditor
                original={oldString}
                modified={newString}
                language={language}
                theme={monacoThemeName}
                options={diffOptions}
                onMount={handleEditorMount}
              />
            </div>
          </section>
        )}

        {/* Content section (Write tool) */}
        {isWrite && (
          <section>
            <h3 className="text-label text-text-ghost font-medium uppercase tracking-wider mb-1.5">
              Written Content
            </h3>
            <pre
              className="text-label font-mono text-text-secondary rounded-lg border border-border-light p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all"
              style={{ background: "var(--bg-primary)" }}
            >
              {writeContent}
            </pre>
          </section>
        )}

        {/* Result section */}
        {entry.status === "done" && entry.result && (
          <section>
            <h3 className="text-label text-text-ghost font-medium uppercase tracking-wider mb-1.5">
              Result
            </h3>
            <pre
              className="text-label font-mono text-text-secondary rounded-lg border border-border-light p-3 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all"
              style={{ background: "var(--bg-primary)" }}
            >
              {entry.result}
            </pre>
          </section>
        )}

        {/* Error section */}
        {entry.isError && entry.result && (
          <section>
            <h3 className="text-label text-red font-medium uppercase tracking-wider mb-1.5">
              Error
            </h3>
            <pre
              className="text-label font-mono text-red rounded-lg border border-red/20 p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all"
              style={{ background: "rgba(248,113,113,0.06)" }}
            >
              {entry.result}
            </pre>
          </section>
        )}

        {/* Question answer section */}
        {activityType === "question" && entry.result && (
          <section>
            <h3 className="text-label text-accent font-medium uppercase tracking-wider mb-1.5">
              Answer
            </h3>
            <pre
              className="text-label font-mono text-text-secondary rounded-lg border border-border-light p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all"
              style={{ background: "var(--bg-primary)" }}
            >
              {entry.result}
            </pre>
          </section>
        )}
      </div>

      {/* Footer */}
      {filePath && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border-light shrink-0">
          <button
            onClick={handleOpenInFileViewer}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent hover:bg-accent/10 transition-colors"
          >
            <ExternalLink size={12} />
            {isEdit ? "Open Diff in File Viewer" : "Open in File Viewer"}
          </button>
        </div>
      )}
    </div>
  );
}
