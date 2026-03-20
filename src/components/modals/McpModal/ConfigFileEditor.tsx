import { useMemo } from "react";
import Editor from "@monaco-editor/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { getMonacoTheme } from "../../../lib/editor-themes";

export default function ConfigFileEditor({
  filePath,
  content,
  onChange,
  onSave,
  onCancel,
}: {
  filePath: string;
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const themeId = useSettingsStore((s) => s.settings.theme);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);
  const monacoThemeName = `codemantis-${themeId}`;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 400 }}>
      <div className="mb-3">
        <h3 className="text-text-primary font-medium">Edit Config File</h3>
        <p className="text-[12px] text-text-dim font-mono mt-1 truncate" title={filePath}>
          {filePath}
        </p>
      </div>

      <div className="flex-1 rounded-lg border border-border overflow-hidden">
        <Editor
          language="json"
          value={content}
          onChange={(v) => onChange(v ?? "")}
          theme={monacoThemeName}
          options={{
            fontSize,
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
          }}
          beforeMount={(monaco) => {
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
              },
            });
          }}
        />
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="px-4 py-1.5 rounded-lg text-ui font-medium text-white bg-accent hover:bg-accent-light transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
