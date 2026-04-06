import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecPreviewPanel from "./SpecPreviewPanel";

// Mock child components to isolate SpecPreviewPanel
vi.mock("./SpecPreview", () => ({
  default: ({ content, auditContent, activeTab, isEditing }: {
    content: string | null;
    auditContent: string | null;
    activeTab: string;
    isEditing: boolean;
  }) => (
    <div data-testid="spec-preview">
      {activeTab === "spec" && content && <div data-testid="spec-content">{content}</div>}
      {activeTab === "audit" && auditContent && <div data-testid="audit-content">{auditContent}</div>}
      {!content && !auditContent && <div data-testid="empty-state">No content</div>}
      {isEditing && <div data-testid="editing-indicator">Editing</div>}
    </div>
  ),
}));

vi.mock("./SavedSpecsList", () => ({
  default: () => <div data-testid="saved-specs-list">Saved Specs</div>,
}));

describe("SpecPreviewPanel", () => {
  const defaultProps = {
    activeProjectPath: "/tmp/project",
    currentSpecContent: null as string | null,
    currentAuditContent: null as string | null,
    isEditing: false,
    isStreaming: false,
    canGenerateAudit: false,
    canSaveAudit: false,
    canSave: false,
    onSpecEdit: vi.fn(),
    onCloseSpec: vi.fn(),
    onToggleEdit: vi.fn(),
    onCopySpec: vi.fn(),
    onGenerateAudit: vi.fn(),
    onOpenSaveAuditDialog: vi.fn(),
    onOpenSaveSpecDialog: vi.fn(),
    onLoadSpec: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders spec content", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# My Specification"
      />,
    );
    expect(screen.getByTestId("spec-content")).toBeInTheDocument();
    expect(screen.getByText("# My Specification")).toBeInTheDocument();
  });

  it("shows empty state when no content", () => {
    render(<SpecPreviewPanel {...defaultProps} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    // No action buttons when there is no spec content
    expect(screen.queryByText("Copy to Clipboard")).not.toBeInTheDocument();
  });

  it("copy button calls onCopySpec", () => {
    const onCopySpec = vi.fn();
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        onCopySpec={onCopySpec}
      />,
    );
    fireEvent.click(screen.getByText("Copy to Clipboard"));
    expect(onCopySpec).toHaveBeenCalledOnce();
  });

  it("shows audit content when in audit mode", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent="## Audit Report"
      />,
    );
    // The useEffect switches to audit tab when auditContent is present
    expect(screen.getByTestId("audit-content")).toBeInTheDocument();
    expect(screen.getByText("## Audit Report")).toBeInTheDocument();
  });
});
