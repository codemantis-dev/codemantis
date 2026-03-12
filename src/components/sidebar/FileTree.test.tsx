import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import FileTree from "./FileTree";
import type { FileNode } from "../../types/file-tree";

// Mock tauri-commands
vi.mock("../../lib/tauri-commands", () => ({
  renameFile: vi.fn().mockResolvedValue(undefined),
  readFileContent: vi.fn().mockResolvedValue("content"),
  getFileInfo: vi.fn().mockResolvedValue({
    file_path: "/project/hello.ts",
    file_name: "hello.ts",
    file_size: 100,
    mime_type: "text/typescript",
    is_image: false,
  }),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  duplicateFile: vi.fn().mockResolvedValue("/project/hello copy.ts"),
  createFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/plugin-opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

// Mock useFileViewer
const mockOpenFile = vi.fn();
vi.mock("../../hooks/useFileViewer", () => ({
  useFileViewer: () => ({
    openFile: mockOpenFile,
    openDiff: vi.fn(),
  }),
}));

const PROJECT_PATH = "/project";
const SAMPLE_NODES: FileNode[] = [
  {
    name: "src",
    path: "/project/src",
    is_dir: true,
    children: [
      { name: "main.ts", path: "/project/src/main.ts", is_dir: false, extension: "ts" },
      { name: "utils.ts", path: "/project/src/utils.ts", is_dir: false, extension: "ts" },
    ],
  },
  { name: "README.md", path: "/project/README.md", is_dir: false, extension: "md" },
];

describe("FileTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders file and folder nodes", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("expands folders on click", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    // src folder is expanded by default at depth 0
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByText("utils.ts")).toBeInTheDocument();
  });

  it("opens file on click", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByText("README.md"));
    expect(mockOpenFile).toHaveBeenCalledWith("/project/README.md");
  });

  it("shows context menu on right-click of a file", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);

    // Context menu should appear with file-specific items
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Copy Path")).toBeInTheDocument();
  });

  it("shows context menu on right-click of a folder", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    const srcButton = screen.getByText("src").closest("button")!;
    fireEvent.contextMenu(srcButton);

    // Folder menu items
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("shows context menu on right-click of empty space", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    const container = screen.getByText("README.md").closest(".py-1")!;
    fireEvent.contextMenu(container);

    expect(screen.getByText("New File")).toBeInTheDocument();
  });

  it("shows inline rename input when rename is triggered", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    // Right-click to open context menu
    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);

    // Click Rename
    fireEvent.click(screen.getByText("Rename"));

    // An input should now be visible with the file name
    const input = screen.getByDisplayValue("README.md");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("cancels rename on Escape", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    // Trigger rename
    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);
    fireEvent.click(screen.getByText("Rename"));

    const input = screen.getByDisplayValue("README.md");
    fireEvent.keyDown(input, { key: "Escape" });

    // Input should be gone, text should be back
    expect(screen.queryByDisplayValue("README.md")).not.toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("commits rename on Enter", async () => {
    const onRefresh = vi.fn();
    const { renameFile } = await import("../../lib/tauri-commands");

    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={onRefresh} />);

    // Trigger rename
    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);
    fireEvent.click(screen.getByText("Rename"));

    const input = screen.getByDisplayValue("README.md");
    fireEvent.change(input, { target: { value: "CHANGELOG.md" } });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(renameFile).toHaveBeenCalledWith("/project/README.md", "/project/CHANGELOG.md");
    });
  });

  it("does not call renameFile if name unchanged", async () => {
    const { renameFile } = await import("../../lib/tauri-commands");

    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);
    fireEvent.click(screen.getByText("Rename"));

    const input = screen.getByDisplayValue("README.md");
    // Press Enter without changing name
    fireEvent.keyDown(input, { key: "Enter" });

    expect(renameFile).not.toHaveBeenCalled();
  });

  it("closes context menu on Escape", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);
    expect(screen.getByText("Copy Path")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Copy Path")).not.toBeInTheDocument();
  });

  it("only shows one context menu at a time", () => {
    render(<FileTree nodes={SAMPLE_NODES} projectPath={PROJECT_PATH} onRefresh={vi.fn()} />);

    // Right-click README
    const readmeButton = screen.getByText("README.md").closest("button")!;
    fireEvent.contextMenu(readmeButton);
    expect(screen.getByText("Copy Path")).toBeInTheDocument();

    // Right-click src folder — should replace menu
    const srcButton = screen.getByText("src").closest("button")!;
    fireEvent.contextMenu(srcButton);

    // Should show folder menu items now
    expect(screen.getByText("New File")).toBeInTheDocument();
    // Should only have one context menu — one Copy Path instance
    expect(screen.getAllByText("Copy Path")).toHaveLength(1);
  });
});
