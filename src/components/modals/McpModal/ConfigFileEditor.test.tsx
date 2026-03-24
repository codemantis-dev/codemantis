import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the editor with title and file path", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    expect(screen.getByText("Edit Config File")).toBeInTheDocument();
    expect(screen.getByText("/path/to/.claude.json")).toBeInTheDocument();
  });

  it("renders Save and Cancel buttons", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onSave when Save button is clicked", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    fireEvent.click(screen.getByText("Save"));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the Monaco editor with the content", () => {
    render(<ConfigFileEditor {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue('{"mcpServers": {}}');
  });
});
