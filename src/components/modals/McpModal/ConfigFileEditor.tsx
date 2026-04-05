import { useMemo } from "react";
import Editor from "@monaco-editor/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { getMonacoTheme } from "../../../lib/editor-themes";

export default function ConfigFileEditor({
  filePath,
  content,
  onChange,
}: {
  filePath: string;
  content: string;
  onChange: (content: string) => void;
}): React.JSX.Element {
  const themeId = useSettingsStore((s) => s.settings.theme);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const monacoColors = useMemo(() => getMonacoTheme(themeId), [themeId]);
  const monacoThemeName = `codemantis-${themeId}`;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 400 }}>
      <p className="text-ui text-text-dim font-mono mb-3 truncate" title={filePath}>
        {filePath}
      </p>

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

    </div>
  );
}
