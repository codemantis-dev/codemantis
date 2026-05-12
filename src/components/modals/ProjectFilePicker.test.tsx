import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProjectFilePicker from "./ProjectFilePicker";
import type { FileNode } from "../../types/file-tree";

const mockReadFileTree = vi.fn();

vi.mock("../../lib/tauri-commands", () => ({
  readFileTree: (...args: unknown[]) => mockReadFileTree(...args),
}));

const PROJECT = "/tmp/project";

function tree(): FileNode[] {
  return [
    {
      name: "src",
      path: `${PROJECT}/src`,
      is_dir: true,
      children: [
        { name: "index.ts", path: `${PROJECT}/src/index.ts`, is_dir: false, extension: "ts" },
        {
          name: "components",
          path: `${PROJECT}/src/components`,
          is_dir: true,
          children: [
            { name: "Button.tsx", path: `${PROJECT}/src/components/Button.tsx`, is_dir: false, extension: "tsx" },
          ],
        },
      ],
    },
    { name: "README.md", path: `${PROJECT}/README.md`, is_dir: false, extension: "md" },
  ];
}

function renderPicker(overrides?: Partial<React.ComponentProps<typeof ProjectFilePicker>>) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <ProjectFilePicker
      open
      projectPath={PROJECT}
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { ...utils, onClose, onConfirm };
}

describe("ProjectFilePicker", () => {
  beforeEach(() => {
    mockReadFileTree.mockReset();
    mockReadFileTree.mockResolvedValue(tree());
  });

  it("loads and renders top-level tree entries when opened", async () => {
    renderPicker();
    expect(await screen.findByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(mockReadFileTree).toHaveBeenCalledWith(PROJECT);
  });

  it("does not load the tree when closed", () => {
    renderPicker({ open: false });
    expect(mockReadFileTree).not.toHaveBeenCalled();
  });

  it("expands a folder to reveal its children", async () => {
    renderPicker();
    const srcRow = await screen.findByText("src");
    fireEvent.click(srcRow);
    expect(await screen.findByText("index.ts")).toBeInTheDocument();
    expect(screen.getByText("components")).toBeInTheDocument();
  });

  it("checkboxes only appear on files, not folders", async () => {
    renderPicker();
    await screen.findByText("src");
    // README.md is a top-level file → has a checkbox
    expect(screen.getByLabelText("Select README.md")).toBeInTheDocument();
    // No checkbox for the src directory
    expect(screen.queryByLabelText("Select src")).toBeNull();
  });

  it("confirm passes the selected relative paths and closes the dialog", async () => {
    const { onConfirm, onClose } = renderPicker();
    await screen.findByText("src");

    fireEvent.click(screen.getByLabelText("Select README.md"));
    // Expand src then select its file
    fireEvent.click(screen.getByText("src"));
    fireEvent.click(await screen.findByLabelText("Select src/index.ts"));

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(new Set(onConfirm.mock.calls[0][0])).toEqual(new Set(["README.md", "src/index.ts"]));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Add button is disabled while nothing is selected", async () => {
    renderPicker();
    await screen.findByText("src");
    const add = screen.getByRole("button", { name: /Add/i });
    expect(add).toBeDisabled();
  });

  it("filter query switches to flat results listing only matching files", async () => {
    renderPicker();
    await screen.findByText("src");

    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "tsx" } });

    // src directory and README.md should disappear in flat mode
    expect(screen.queryByText("src")).toBeNull();
    expect(screen.queryByText("README.md")).toBeNull();
    // Only the matching nested file should be visible
    expect(screen.getByText("src/components/Button.tsx")).toBeInTheDocument();
  });

  it("filter view supports selecting deeply-nested files without manual expand", async () => {
    const { onConfirm } = renderPicker();
    await screen.findByText("src");

    fireEvent.change(screen.getByLabelText("Filter files"), { target: { value: "Button" } });
    fireEvent.click(await screen.findByLabelText("Select src/components/Button.tsx"));
    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    expect(onConfirm).toHaveBeenCalledWith(["src/components/Button.tsx"]);
  });

  it("Cancel calls onClose without invoking onConfirm", async () => {
    const { onConfirm, onClose } = renderPicker();
    await screen.findByText("src");
    fireEvent.click(screen.getByLabelText("Select README.md"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key closes without confirming", async () => {
    const { onConfirm, onClose } = renderPicker();
    await screen.findByText("src");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Enter confirms with the current selection", async () => {
    const { onConfirm } = renderPicker();
    await screen.findByText("src");
    fireEvent.click(screen.getByLabelText("Select README.md"));
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onConfirm).toHaveBeenCalledWith(["README.md"]);
  });

  it("pre-seeds selection from alreadySelectedPaths", async () => {
    renderPicker({ alreadySelectedPaths: ["README.md"] });
    await screen.findByText("README.md");
    const cb = screen.getByLabelText("Select README.md") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("shows an error message when readFileTree fails", async () => {
    mockReadFileTree.mockReset();
    mockReadFileTree.mockRejectedValueOnce(new Error("boom"));
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
    });
  });
});
