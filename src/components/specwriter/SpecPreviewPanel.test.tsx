import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecPreviewPanel from "./SpecPreviewPanel";

// Mock child components to isolate SpecPreviewPanel
vi.mock("./SpecPreview", () => ({
  default: ({ content, auditContent, activeTab, onTabChange, isEditing }: {
    content: string | null;
    auditContent: string | null;
    activeTab: string;
    onTabChange: (tab: string) => void;
    isEditing: boolean;
  }) => (
    <div data-testid="spec-preview">
      {activeTab === "spec" && content && <div data-testid="spec-content">{content}</div>}
      {activeTab === "audit" && auditContent && <div data-testid="audit-content">{auditContent}</div>}
      {!content && !auditContent && <div data-testid="empty-state">No content</div>}
      {isEditing && <div data-testid="editing-indicator">Editing</div>}
      {content && auditContent && (
        <>
          <button data-testid="tab-spec" onClick={() => onTabChange("spec")}>Specification</button>
          <button data-testid="tab-audit" onClick={() => onTabChange("audit")}>Verification Audit</button>
        </>
      )}
    </div>
  ),
}));

vi.mock("./SavedSpecsList", () => ({
  default: () => <div data-testid="saved-specs-list">Saved Specs</div>,
}));

const mockShowToast = vi.fn();
vi.mock("../../stores/toastStore", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
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
    onGenerateAudit: vi.fn(),
    onOpenSaveAuditDialog: vi.fn(),
    onOpenSaveSpecDialog: vi.fn(),
    onLoadSpec: vi.fn(),
    effectiveSpecFilename: null as string | null,
    hasGuide: false,
    onRecognizeGuide: vi.fn(),
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

  it("copy button copies spec content on spec tab", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        canSave
      />,
    );
    fireEvent.click(screen.getByText("Copy to Clipboard"));
    expect(writeText).toHaveBeenCalledWith("# Spec");
    expect(mockShowToast).toHaveBeenCalledWith("Copied to clipboard", "success");
  });

  it("copy button copies audit content on audit tab", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentAuditContent="## Audit Report"
        canSaveAudit
      />,
    );
    fireEvent.click(screen.getByText("Copy to Clipboard"));
    expect(writeText).toHaveBeenCalledWith("## Audit Report");
  });

  it("shows toolbar when only audit content exists (no spec content)", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent={null}
        currentAuditContent="## Audit Report"
        canSaveAudit
      />,
    );
    expect(screen.getByText("Copy to Clipboard")).toBeInTheDocument();
    expect(screen.getByText("Save Audit")).toBeInTheDocument();
    expect(screen.queryByText("Save Spec")).not.toBeInTheDocument();
  });

  it("hides edit button when active tab is audit", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent={null}
        currentAuditContent="## Audit Report"
        canSaveAudit
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("shows edit button when active tab is spec", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        canSave
      />,
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("auto-switches to audit tab when audit content first appears", () => {
    const { rerender } = render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent={null}
      />,
    );
    // Initially on spec tab
    expect(screen.getByTestId("spec-content")).toBeInTheDocument();

    // Audit content appears — should auto-switch
    rerender(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent="## Audit Report"
      />,
    );
    expect(screen.getByTestId("audit-content")).toBeInTheDocument();
    expect(screen.getByText("## Audit Report")).toBeInTheDocument();
  });

  it("allows switching back to spec tab when both documents exist", () => {
    render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent="## Audit Report"
      />,
    );
    // Starts on audit tab (auto-switched)
    expect(screen.getByTestId("audit-content")).toBeInTheDocument();

    // Click spec tab — should switch and stay
    fireEvent.click(screen.getByTestId("tab-spec"));
    expect(screen.getByTestId("spec-content")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-content")).not.toBeInTheDocument();
  });

  it("does not snap back to audit tab after user switches to spec", () => {
    const { rerender } = render(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent="## Audit Report"
      />,
    );

    // User clicks spec tab
    fireEvent.click(screen.getByTestId("tab-spec"));
    expect(screen.getByTestId("spec-content")).toBeInTheDocument();

    // Re-render with same audit content (simulates parent re-render)
    rerender(
      <SpecPreviewPanel
        {...defaultProps}
        currentSpecContent="# Spec"
        currentAuditContent="## Audit Report"
      />,
    );
    // Should remain on spec tab
    expect(screen.getByTestId("spec-content")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-content")).not.toBeInTheDocument();
  });
});
