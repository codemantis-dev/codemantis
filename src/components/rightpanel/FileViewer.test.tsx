import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileViewer from "./FileViewer";
import { useFileViewerStore } from "../../stores/fileViewerStore";

// Mock Monaco Editor — it requires a browser canvas context
vi.mock("@monaco-editor/react", () => {
  function MockEditor({ value, language }: { value: string; language: string }) {
    return (
      <div data-testid="mock-editor" data-language={language}>
        {value}
      </div>
    );
  }
  function MockDiffEditor({
    original,
    modified,
    language,
  }: {
    original: string;
    modified: string;
    language: string;
  }) {
    return (
      <div data-testid="mock-diff-editor" data-language={language}>
        <div data-testid="diff-original">{original}</div>
        <div data-testid="diff-modified">{modified}</div>
      </div>
    );
  }
  return {
    __esModule: true,
    default: MockEditor,
    DiffEditor: MockDiffEditor,
  };
});

describe("FileViewer", () => {
  beforeEach(() => {
    useFileViewerStore.setState({ openFile: null });
  });

  it("shows empty state when no file is open", () => {
    render(<FileViewer />);
    expect(screen.getByText("No file open")).toBeInTheDocument();
    expect(
      screen.getByText("Click a file in the sidebar or activity feed")
    ).toBeInTheDocument();
  });

  it("renders file name in header", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/src/main.rs",
      fileName: "main.rs",
      language: "rust",
      extension: "rs",
      fileSize: 256,
      content: "fn main() {}",
      isDiff: false,
    });
    render(<FileViewer />);
    expect(screen.getByText("main.rs")).toBeInTheDocument();
  });

  it("renders extension badge", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/src/app.tsx",
      fileName: "app.tsx",
      language: "typescript",
      extension: "tsx",
      fileSize: 512,
      content: "export default function App() {}",
      isDiff: false,
    });
    render(<FileViewer />);
    expect(screen.getByText(".tsx")).toBeInTheDocument();
  });

  it("renders file size for normal files", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/data.json",
      fileName: "data.json",
      language: "json",
      extension: "json",
      fileSize: 4096,
      content: "{}",
      isDiff: false,
    });
    render(<FileViewer />);
    expect(screen.getByText("4.0 KB")).toBeInTheDocument();
  });

  it("renders Monaco editor with file content", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/test.py",
      fileName: "test.py",
      language: "python",
      extension: "py",
      fileSize: 20,
      content: 'print("hello")',
      isDiff: false,
    });
    render(<FileViewer />);
    const editor = screen.getByTestId("mock-editor");
    expect(editor).toBeInTheDocument();
    expect(editor.getAttribute("data-language")).toBe("python");
    expect(editor.textContent).toBe('print("hello")');
  });

  it("renders DiffEditor for diff mode", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/lib.ts",
      fileName: "lib.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 100,
      content: null,
      isDiff: true,
      oldContent: "const a = 1;",
      newContent: "const a = 2;",
    });
    render(<FileViewer />);
    const diffEditor = screen.getByTestId("mock-diff-editor");
    expect(diffEditor).toBeInTheDocument();
    expect(screen.getByTestId("diff-original").textContent).toBe(
      "const a = 1;"
    );
    expect(screen.getByTestId("diff-modified").textContent).toBe(
      "const a = 2;"
    );
  });

  it("shows diff summary (+N -M) for diff files", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/lib.ts",
      fileName: "lib.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 100,
      content: null,
      isDiff: true,
      oldContent: "line1\nline2\nline3",
      newContent: "line1\nlineX\nline3\nline4",
    });
    render(<FileViewer />);
    // line2 removed, lineX and line4 added
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("closes file when X button is clicked", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/test.rs",
      fileName: "test.rs",
      language: "rust",
      extension: "rs",
      fileSize: 10,
      content: "fn test() {}",
      isDiff: false,
    });
    render(<FileViewer />);

    // Find the close button (last button in toolbar)
    const buttons = screen.getAllByRole("button");
    const closeButton = buttons[buttons.length - 1]; // Close is last
    fireEvent.click(closeButton);

    expect(useFileViewerStore.getState().openFile).toBeNull();
  });

  it("renders word wrap toggle button", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/a.ts",
      fileName: "a.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 5,
      content: "x",
      isDiff: false,
    });
    render(<FileViewer />);
    // Word wrap button should exist (it's one of the buttons)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2); // word wrap + close
  });

  it("renders side-by-side toggle only in diff mode", () => {
    // Normal mode — no side-by-side button
    useFileViewerStore.getState().setOpenFile({
      filePath: "/a.ts",
      fileName: "a.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 5,
      content: "x",
      isDiff: false,
    });
    const { unmount } = render(<FileViewer />);
    const normalButtons = screen.getAllByRole("button");
    expect(normalButtons).toHaveLength(2); // word wrap + close
    unmount();

    // Diff mode — has side-by-side button
    useFileViewerStore.getState().setOpenFile({
      filePath: "/a.ts",
      fileName: "a.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 5,
      content: null,
      isDiff: true,
      oldContent: "a",
      newContent: "b",
    });
    render(<FileViewer />);
    const diffButtons = screen.getAllByRole("button");
    expect(diffButtons).toHaveLength(3); // word wrap + side-by-side + close
  });

  it("does not show file size for diff files", () => {
    useFileViewerStore.getState().setOpenFile({
      filePath: "/a.ts",
      fileName: "a.ts",
      language: "typescript",
      extension: "ts",
      fileSize: 4096,
      content: null,
      isDiff: true,
      oldContent: "old",
      newContent: "new",
    });
    render(<FileViewer />);
    expect(screen.queryByText("4.0 KB")).not.toBeInTheDocument();
  });
});
