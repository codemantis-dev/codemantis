import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GuideReplaceConfirmModal from "./GuideReplaceConfirmModal";

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Close: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <button className={className}>{children}</button>
  ),
}));

describe("GuideReplaceConfirmModal", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when open", () => {
    render(
      <GuideReplaceConfirmModal
        open={true}
        currentGuideTitle="Auth Feature"
        newSpecFilename="dashboard.md"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Replace Implementation Guide?")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <GuideReplaceConfirmModal
        open={false}
        currentGuideTitle="Auth Feature"
        newSpecFilename="dashboard.md"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(container.querySelector("[data-testid='dialog-root']")).toBeNull();
  });

  it("displays current guide title and new spec filename", () => {
    render(
      <GuideReplaceConfirmModal
        open={true}
        currentGuideTitle="Auth Feature"
        newSpecFilename="dashboard.md"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText(/Auth Feature/)).toBeInTheDocument();
    expect(screen.getByText(/dashboard\.md/)).toBeInTheDocument();
  });

  it("calls onConfirm when Replace Guide is clicked", () => {
    render(
      <GuideReplaceConfirmModal
        open={true}
        currentGuideTitle="Auth Feature"
        newSpecFilename="dashboard.md"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Replace Guide"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", () => {
    render(
      <GuideReplaceConfirmModal
        open={true}
        currentGuideTitle="Auth Feature"
        newSpecFilename="dashboard.md"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
