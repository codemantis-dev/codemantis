import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SavedSpecsList from "./SavedSpecsList";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import type { SpecDocumentInfo } from "../../types/spec-writer";

// Mock tauri-commands
const mockListSpecDocuments = vi.fn().mockResolvedValue([]);
const mockReadSpecDocument = vi.fn().mockResolvedValue("# Spec Content");
const mockDeleteSpecDocument = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/tauri-commands", () => ({
  listSpecDocuments: (...args: unknown[]) => mockListSpecDocuments(...args),
  readSpecDocument: (...args: unknown[]) => mockReadSpecDocument(...args),
  deleteSpecDocument: (...args: unknown[]) => mockDeleteSpecDocument(...args),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

const PROJECT_PATH = "/tmp/project";

const makeSpec = (overrides?: Partial<SpecDocumentInfo>): SpecDocumentInfo => ({
  filename: "feature.md",
  title: "Feature Spec",
  modified_at: "2026-01-15T10:00:00Z",
  size_bytes: 1024,
  path: "/tmp/project/docs/specs/feature.md",
  ...overrides,
});

describe("SavedSpecsList", () => {
  const onLoadSpec = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSpecWriterStore.setState({
      savedSpecs: new Map(),
      uiState: new Map(),
      currentSpecContent: new Map(),
    });
  });

  it("renders 'No specifications yet' when empty", async () => {
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    await waitFor(() => {
      expect(screen.getByText("No specifications yet.")).toBeInTheDocument();
    });
  });

  it("renders spec list when specs exist", async () => {
    useSpecWriterStore.setState({
      savedSpecs: new Map([
        [PROJECT_PATH, [makeSpec(), makeSpec({ filename: "auth.md", title: "Auth Spec" })]],
      ]),
    });
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    expect(screen.getByText("Feature Spec")).toBeInTheDocument();
    expect(screen.getByText("Auth Spec")).toBeInTheDocument();
  });

  it("shows spec count in header", async () => {
    useSpecWriterStore.setState({
      savedSpecs: new Map([
        [PROJECT_PATH, [makeSpec()]],
      ]),
    });
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    expect(screen.getByText("Saved Specs (1)")).toBeInTheDocument();
  });

  it("collapses and expands on header click", async () => {
    useSpecWriterStore.setState({
      savedSpecs: new Map([[PROJECT_PATH, [makeSpec()]]]),
    });
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    expect(screen.getByText("Feature Spec")).toBeInTheDocument();

    // Collapse
    fireEvent.click(screen.getByText("Saved Specs (1)"));
    expect(screen.queryByText("Feature Spec")).not.toBeInTheDocument();

    // Expand again
    fireEvent.click(screen.getByText("Saved Specs (1)"));
    expect(screen.getByText("Feature Spec")).toBeInTheDocument();
  });

  it("loads spec on item click", async () => {
    const spec = makeSpec();
    useSpecWriterStore.setState({
      savedSpecs: new Map([[PROJECT_PATH, [spec]]]),
    });
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    fireEvent.click(screen.getByText("Feature Spec"));

    await waitFor(() => {
      expect(mockReadSpecDocument).toHaveBeenCalledWith(PROJECT_PATH, "feature.md");
    });
  });

  it("calls listSpecDocuments on mount", async () => {
    render(<SavedSpecsList projectPath={PROJECT_PATH} onLoadSpec={onLoadSpec} />);
    await waitFor(() => {
      expect(mockListSpecDocuments).toHaveBeenCalledWith(PROJECT_PATH);
    });
  });
});
