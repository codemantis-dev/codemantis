import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActivityDetailPanel from "./ActivityDetailPanel";
import { useUiStore } from "../../stores/uiStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { ActivityEntry } from "../../types/activity";

// Mock Monaco DiffEditor
vi.mock("@monaco-editor/react", () => {
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
    default: () => null,
    DiffEditor: MockDiffEditor,
  };
});

// Mock tauri-commands
const mockReadFileContent = vi.fn<(path: string) => Promise<string>>(() => Promise.resolve("file content"));
vi.mock("../../lib/tauri-commands", () => ({
  readFileContent: (path: string) => mockReadFileContent(path),
}));

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "a1",
    toolUseId: "t1",
    toolName: "Bash",
    toolInput: { command: "npm test" },
    status: "done",
    timestamp: "2026-01-15T14:30:00Z",
    messageId: "m1",
    isError: false,
    durationMs: 1250,
    result: "All tests passed",
    ...overrides,
  };
}

function showEntry(entry: ActivityEntry): void {
  useUiStore.setState({ selectedActivityEntry: entry });
}

describe("ActivityDetailPanel", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedActivityEntry: null, rightTab: "activity" });
    useSessionStore.setState({ activeProjectPath: "/project" });
    mockReadFileContent.mockReset().mockResolvedValue("file content");
  });

  it("renders nothing when no entry is selected", () => {
    const { container } = render(<ActivityDetailPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("renders tool name and badge for a Bash entry", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("BA")).toBeInTheDocument();
  });

  it("renders input key-value pairs", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);
    expect(screen.getByText("command")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("renders result section for completed tools", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);
    expect(screen.getByText("All tests passed")).toBeInTheDocument();
  });

  it("renders duration", () => {
    showEntry(makeEntry({ durationMs: 3500 }));
    render(<ActivityDetailPanel />);
    expect(screen.getByText("4s")).toBeInTheDocument();
  });

  it("renders error section for error entries", () => {
    showEntry(makeEntry({ isError: true, status: "error", result: "segmentation fault" }));
    render(<ActivityDetailPanel />);
    expect(screen.getByText("segmentation fault")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders DiffEditor for Edit tool entries", () => {
    showEntry(
      makeEntry({
        toolName: "Edit",
        toolInput: {
          file_path: "src/main.ts",
          old_string: "const a = 1;",
          new_string: "const a = 2;",
        },
        result: "File edited",
      })
    );
    render(<ActivityDetailPanel />);
    expect(screen.getByTestId("mock-diff-editor")).toBeInTheDocument();
    expect(screen.getByTestId("diff-original")).toHaveTextContent("const a = 1;");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("const a = 2;");
    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("renders written content for Write tool entries", () => {
    showEntry(
      makeEntry({
        toolName: "Write",
        toolInput: {
          file_path: "src/new-file.ts",
          content: "export const x = 42;",
        },
        result: "File written",
      })
    );
    render(<ActivityDetailPanel />);
    expect(screen.getByText("Written Content")).toBeInTheDocument();
    expect(screen.getByText("export const x = 42;")).toBeInTheDocument();
  });

  it("shows 'Open in File Viewer' footer for file tools", () => {
    showEntry(
      makeEntry({
        toolName: "Read",
        toolInput: { file_path: "src/main.ts" },
        result: "file contents",
      })
    );
    render(<ActivityDetailPanel />);
    expect(screen.getByText("Open in File Viewer")).toBeInTheDocument();
  });

  it("shows 'Open Diff in File Viewer' footer for Edit tools", () => {
    showEntry(
      makeEntry({
        toolName: "Edit",
        toolInput: {
          file_path: "src/main.ts",
          old_string: "a",
          new_string: "b",
        },
      })
    );
    render(<ActivityDetailPanel />);
    expect(screen.getByText("Open Diff in File Viewer")).toBeInTheDocument();
  });

  it("does not show footer for tools without file_path", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);
    expect(screen.queryByText("Open in File Viewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Open Diff in File Viewer")).not.toBeInTheDocument();
  });

  it("dismisses on Escape key", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);
    expect(screen.getByText("Bash")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useUiStore.getState().selectedActivityEntry).toBeNull();
  });

  it("dismisses on back button click", () => {
    showEntry(makeEntry());
    render(<ActivityDetailPanel />);

    fireEvent.click(screen.getByTitle("Back (Escape)"));

    expect(useUiStore.getState().selectedActivityEntry).toBeNull();
  });

  it("opens diff in file viewer for Edit tool footer action", () => {
    const openFileSpy = vi.spyOn(useFileViewerStore.getState(), "openFile");

    showEntry(
      makeEntry({
        toolName: "Edit",
        toolInput: {
          file_path: "src/main.ts",
          old_string: "old",
          new_string: "new",
        },
      })
    );
    render(<ActivityDetailPanel />);

    fireEvent.click(screen.getByText("Open Diff in File Viewer"));

    // Should dismiss the panel
    expect(useUiStore.getState().selectedActivityEntry).toBeNull();
    // Should open diff in file viewer
    expect(openFileSpy).toHaveBeenCalledWith("/project", expect.objectContaining({
      filePath: "src/main.ts",
      isDiff: true,
      oldContent: "old",
      newContent: "new",
    }));
    // Should switch to files tab
    expect(useUiStore.getState().rightTab).toBe("files");

    openFileSpy.mockRestore();
  });

  it("opens file in file viewer for Read tool footer action", async () => {
    showEntry(
      makeEntry({
        toolName: "Read",
        toolInput: { file_path: "src/main.ts" },
        result: "contents",
      })
    );
    render(<ActivityDetailPanel />);

    fireEvent.click(screen.getByText("Open in File Viewer"));

    // Should dismiss the panel immediately
    expect(useUiStore.getState().selectedActivityEntry).toBeNull();
    // readFileContent is async, wait for it
    await vi.waitFor(() => {
      expect(mockReadFileContent).toHaveBeenCalledWith("src/main.ts");
    });
  });

  it("renders MCP tool names formatted", () => {
    showEntry(
      makeEntry({
        toolName: "mcp__supabase__execute_sql",
        toolInput: { query: "SELECT 1" },
      })
    );
    render(<ActivityDetailPanel />);
    expect(screen.getByText("supabase: execute_sql")).toBeInTheDocument();
    expect(screen.getByText("MC")).toBeInTheDocument();
  });
});
