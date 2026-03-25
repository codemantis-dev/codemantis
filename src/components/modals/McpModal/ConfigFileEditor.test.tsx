import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfigFileEditor from "./ConfigFileEditor";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { theme: "midnight", fontSize: 13 } }),
}));
vi.mock("../../../lib/editor-themes", () => ({
  getMonacoTheme: () => ({
    base: "vs-dark",
    editorBackground: "#1a1a2e",
    lineHighlightBackground: "#222240",
    lineNumberForeground: "#555",
    lineNumberActiveForeground: "#aaa",
    selectionBackground: "#264f78",
    widgetBackground: "#1a1a2e",
    widgetBorder: "#333",
  }),
}));

describe("ConfigFileEditor", () => {
  const defaultProps = {
    filePath: "/path/to/.claude.json",
    content: '{"mcpServers": {}}',
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the file path", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    expect(screen.getByText("/path/to/.claude.json")).toBeInTheDocument();
  });

  it("renders the Monaco editor with the content", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue('{"mcpServers": {}}');
  });
});
