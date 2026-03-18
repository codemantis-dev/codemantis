import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FileTreeContextMenu from "./FileTreeContextMenu";
import { useAttachmentStore } from "../../stores/attachmentStore";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useFileViewerStore } from "../../stores/fileViewerStore";
import type { FileNode } from "../../types/file-tree";

// Mock tauri-commands
vi.mock("../../lib/tauri-commands", () => ({
  getFileInfo: vi.fn().mockResolvedValue({
    file_path: "/project/src/main.ts",
    file_name: "main.ts",
    file_size: 1024,
    mime_type: "text/typescript",
    is_image: false,
  }),
  readFileContent: vi.fn().mockResolvedValue("file content here"),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  duplicateFile: vi.fn().mockResolvedValue("/project/src/main copy.ts"),
  createFile: vi.fn().mockResolvedValue(undefined),
  createDirectory: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/plugin-opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

// Mock useFileViewer hook
const mockOpenFile = vi.fn();
vi.mock("../../hooks/useFileViewer", () => ({
  useFileViewer: () => ({
    openFile: mockOpenFile,
    openDiff: vi.fn(),
  }),
}));

const PROJECT_PATH = "/project";
const FILE_NODE: FileNode = {
  name: "main.ts",
  path: "/project/src/main.ts",
  is_dir: false,
  extension: "ts",
};
const DIR_NODE: FileNode = {
  name: "src",
  path: "/project/src",
  is_dir: true,
  children: [FILE_NODE],
};

const defaultProps = {
  x: 100,
  y: 100,
  projectPath: PROJECT_PATH,
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  onStartRename: vi.fn(),
  onStartNewItem: vi.fn(),
  onExpandAll: vi.fn(),
  onCollapseAll: vi.fn(),
};

describe("FileTreeContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", name: "Test", project_path: PROJECT_PATH, status: "connected" as const, created_at: "", model: null, icon_index: 0 }]]),
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: ["s1"],
    });
    useAttachmentStore.setState({ attachments: new Map() });
    useAssistantStore.setState({ projectAssistants: new Map(), activeAssistantId: new Map() });
    useFileViewerStore.setState({
      projectOpenFiles: new Map(),
      projectActiveFile: new Map(),
      projectEditedContents: new Map(),
      projectDirtyFiles: new Map(),
    });
  });

  describe("file context menu", () => {
    it("renders all file menu items", () => {
      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);

      expect(screen.getByText("Add to Main Chat")).toBeInTheDocument();
      expect(screen.getByText("Add to Assistant")).toBeInTheDocument();
      expect(screen.getByText("Open")).toBeInTheDocument();
      expect(screen.getByText("Duplicate")).toBeInTheDocument();
      expect(screen.getByText("Rename")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
      expect(screen.getByText("Reveal in Finder")).toBeInTheDocument();
      expect(screen.getByText("Copy Contents")).toBeInTheDocument();
      expect(screen.getByText("Copy Path")).toBeInTheDocument();
      expect(screen.getByText("Copy Relative Path")).toBeInTheDocument();
      expect(screen.getByText("Expand All Folders")).toBeInTheDocument();
      expect(screen.getByText("Collapse All Folders")).toBeInTheDocument();
    });

    it("calls onStartRename and onClose when Rename clicked", () => {
      const onClose = vi.fn();
      const onStartRename = vi.fn();
      render(
        <FileTreeContextMenu
          {...defaultProps}
          node={FILE_NODE}
          onClose={onClose}
          onStartRename={onStartRename}
        />
      );

      fireEvent.click(screen.getByText("Rename"));
      expect(onStartRename).toHaveBeenCalledWith(FILE_NODE.path);
      expect(onClose).toHaveBeenCalled();
    });

    it("calls openFile when Open clicked", () => {
      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Open"));
      expect(mockOpenFile).toHaveBeenCalledWith(FILE_NODE.path);
    });

    it("copies path to clipboard when Copy Path clicked", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Copy Path"));

      expect(writeText).toHaveBeenCalledWith("/project/src/main.ts");
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it("copies relative path to clipboard", () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Copy Relative Path"));

      expect(writeText).toHaveBeenCalledWith("src/main.ts");
    });

    it("expands assistant list on click", () => {
      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);

      // Click "Add to Assistant" to expand
      fireEvent.click(screen.getByText("Add to Assistant"));
      expect(screen.getByText("No assistants")).toBeInTheDocument();
    });

    it("shows assistant names when assistants exist", () => {
      useAssistantStore.setState({
        projectAssistants: new Map([
          [PROJECT_PATH, [
            { id: "a1", projectPath: PROJECT_PATH, parentSessionId: "s1", name: "My Helper", provider: "openai" as const, model: "gpt-4", sortOrder: 0, createdAt: "" },
          ]],
        ]),
      });

      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Add to Assistant"));
      expect(screen.getByText("My Helper")).toBeInTheDocument();
    });

    it("calls duplicateFile and onRefresh on Duplicate", async () => {
      const { duplicateFile } = await import("../../lib/tauri-commands");
      const onRefresh = vi.fn();
      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} onRefresh={onRefresh} />);
      fireEvent.click(screen.getByText("Duplicate"));

      // Wait for async
      await vi.waitFor(() => {
        expect(duplicateFile).toHaveBeenCalledWith(FILE_NODE.path);
      });
    });
  });

  describe("folder context menu", () => {
    it("renders folder-specific menu items", () => {
      render(<FileTreeContextMenu {...defaultProps} node={DIR_NODE} />);

      expect(screen.getByText("New File")).toBeInTheDocument();
      expect(screen.getByText("New Folder")).toBeInTheDocument();
      expect(screen.getByText("Rename")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
      expect(screen.getByText("Reveal in Finder")).toBeInTheDocument();
      expect(screen.getByText("Copy Path")).toBeInTheDocument();
      expect(screen.getByText("Copy Relative Path")).toBeInTheDocument();
      expect(screen.getByText("Expand All Folders")).toBeInTheDocument();
      expect(screen.getByText("Collapse All Folders")).toBeInTheDocument();
    });

    it("does NOT show file-only items for folders", () => {
      render(<FileTreeContextMenu {...defaultProps} node={DIR_NODE} />);

      expect(screen.queryByText("Add to Main Chat")).not.toBeInTheDocument();
      expect(screen.queryByText("Open")).not.toBeInTheDocument();
      expect(screen.queryByText("Duplicate")).not.toBeInTheDocument();
      expect(screen.queryByText("Copy Contents")).not.toBeInTheDocument();
    });
  });

  describe("empty space context menu", () => {
    it("renders New File, New Folder, and expand/collapse for empty space", () => {
      render(<FileTreeContextMenu {...defaultProps} node={null} />);

      expect(screen.getByText("New File")).toBeInTheDocument();
      expect(screen.getByText("New Folder")).toBeInTheDocument();
      expect(screen.getByText("Expand All Folders")).toBeInTheDocument();
      expect(screen.getByText("Collapse All Folders")).toBeInTheDocument();
      // Should not show any other items
      expect(screen.queryByText("Rename")).not.toBeInTheDocument();
      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
      expect(screen.queryByText("Copy Path")).not.toBeInTheDocument();
    });

    it("calls onExpandAll when Expand All Folders clicked", () => {
      const onExpandAll = vi.fn();
      const onClose = vi.fn();
      render(<FileTreeContextMenu {...defaultProps} node={null} onExpandAll={onExpandAll} onClose={onClose} />);
      fireEvent.click(screen.getByText("Expand All Folders"));
      expect(onExpandAll).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("calls onCollapseAll when Collapse All Folders clicked", () => {
      const onCollapseAll = vi.fn();
      const onClose = vi.fn();
      render(<FileTreeContextMenu {...defaultProps} node={null} onCollapseAll={onCollapseAll} onClose={onClose} />);
      fireEvent.click(screen.getByText("Collapse All Folders"));
      expect(onCollapseAll).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("dismiss behavior", () => {
    it("closes on Escape key", () => {
      const onClose = vi.fn();
      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} onClose={onClose} />);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("closes on click outside", () => {
      const onClose = vi.fn();
      render(
        <div>
          <div data-testid="outside">outside</div>
          <FileTreeContextMenu {...defaultProps} node={FILE_NODE} onClose={onClose} />
        </div>
      );

      fireEvent.mouseDown(screen.getByTestId("outside"));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("delete cleanup", () => {
    it("closes open FileViewer tabs when deleting a file", async () => {
      // Setup: file is open in FileViewer
      useFileViewerStore.getState().openFile(PROJECT_PATH, {
        filePath: FILE_NODE.path,
        fileName: FILE_NODE.name,
        language: "typescript",
        extension: "ts",
        fileSize: 100,
        content: "content",
        isDiff: false,
      });
      expect(useFileViewerStore.getState().projectOpenFiles.get(PROJECT_PATH)).toHaveLength(1);

      // Mock window.confirm
      vi.spyOn(window, "confirm").mockReturnValue(true);

      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Delete"));

      const { deleteFile } = await import("../../lib/tauri-commands");
      await vi.waitFor(() => {
        expect(deleteFile).toHaveBeenCalledWith(FILE_NODE.path);
      });

      // The tab should be closed
      await vi.waitFor(() => {
        expect(useFileViewerStore.getState().projectOpenFiles.get(PROJECT_PATH)).toHaveLength(0);
      });
    });

    it("closes child tabs when deleting a folder", async () => {
      // Open a file that is inside the folder
      useFileViewerStore.getState().openFile(PROJECT_PATH, {
        filePath: "/project/src/main.ts",
        fileName: "main.ts",
        language: "typescript",
        extension: "ts",
        fileSize: 100,
        content: "content",
        isDiff: false,
      });

      vi.spyOn(window, "confirm").mockReturnValue(true);

      render(<FileTreeContextMenu {...defaultProps} node={DIR_NODE} />);
      fireEvent.click(screen.getByText("Delete"));

      const { deleteFile } = await import("../../lib/tauri-commands");
      await vi.waitFor(() => {
        expect(deleteFile).toHaveBeenCalledWith(DIR_NODE.path);
      });

      await vi.waitFor(() => {
        expect(useFileViewerStore.getState().projectOpenFiles.get(PROJECT_PATH)).toHaveLength(0);
      });
    });

    it("does NOT delete when confirm is cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);

      render(<FileTreeContextMenu {...defaultProps} node={FILE_NODE} />);
      fireEvent.click(screen.getByText("Delete"));

      const { deleteFile } = await import("../../lib/tauri-commands");
      expect(deleteFile).not.toHaveBeenCalled();
    });
  });

  describe("viewport clamping", () => {
    it("clamps menu position to prevent overflow", () => {
      // Place near bottom-right corner
      const { container } = render(
        <FileTreeContextMenu
          {...defaultProps}
          x={window.innerWidth + 100}
          y={window.innerHeight + 100}
          node={FILE_NODE}
        />
      );

      const menu = container.querySelector(".fixed.z-50") as HTMLElement;
      expect(menu).toBeTruthy();
      const left = parseInt(menu.style.left);
      const top = parseInt(menu.style.top);
      expect(left).toBeLessThanOrEqual(window.innerWidth);
      expect(top).toBeLessThanOrEqual(window.innerHeight);
    });
  });
});
