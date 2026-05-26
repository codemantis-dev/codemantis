import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecWriterToolbar from "./SpecWriterToolbar";

const baseProps = {
  lastSavedFile: null as string | null,
  activeSessionId: "s1" as string | null,
  canWrite: false,
  isStreaming: false,
  conversationMode: "feature" as string | undefined,
  hasGuide: false,
  onSendToChat: vi.fn(),
  onImplement: vi.fn(),
  onUseGuide: vi.fn(),
  onRecognizeGuide: vi.fn(),
  onWriteSpec: vi.fn(),
  onReset: vi.fn(),
  onSuggestFeatures: vi.fn(),
  onClose: vi.fn(),
};

describe("SpecWriterToolbar", () => {
  it("renders SpecWriter title", () => {
    render(<SpecWriterToolbar {...baseProps} />);
    expect(screen.getByText("SpecWriter")).toBeInTheDocument();
  });

  it("renders Generate Spec button", () => {
    render(<SpecWriterToolbar {...baseProps} />);
    expect(screen.getByText("Generate Spec")).toBeInTheDocument();
  });

  it("renders Close button", () => {
    render(<SpecWriterToolbar {...baseProps} />);
    expect(screen.getByTitle("Close SpecWriter")).toBeInTheDocument();
  });

  // ── Use Guide button ──

  it("hides 'Use Guide' when hasGuide is false", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={false} />);
    expect(screen.queryByText("Use Guide")).not.toBeInTheDocument();
  });

  it("hides 'Use Guide' when hasGuide is true but no file saved", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile={null} hasGuide={true} />);
    expect(screen.queryByText("Use Guide")).not.toBeInTheDocument();
  });

  it("shows 'Use Guide' when hasGuide is true and file is saved", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={true} />);
    expect(screen.getByText("Use Guide")).toBeInTheDocument();
  });

  it("calls onUseGuide when 'Use Guide' is clicked", () => {
    const onUseGuide = vi.fn();
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={true} onUseGuide={onUseGuide} />);
    fireEvent.click(screen.getByText("Use Guide"));
    expect(onUseGuide).toHaveBeenCalledTimes(1);
  });

  // ── Recognize Guide button ──

  it("shows 'Recognize Guide' when file saved but no guide", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={false} />);
    expect(screen.getByText("Recognize Guide")).toBeInTheDocument();
    expect(screen.queryByText("Use Guide")).not.toBeInTheDocument();
  });

  it("hides 'Recognize Guide' when guide exists", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={true} />);
    expect(screen.queryByText("Recognize Guide")).not.toBeInTheDocument();
    expect(screen.getByText("Use Guide")).toBeInTheDocument();
  });

  it("hides 'Recognize Guide' when no file saved", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile={null} hasGuide={false} />);
    expect(screen.queryByText("Recognize Guide")).not.toBeInTheDocument();
  });

  it("calls onRecognizeGuide when clicked", () => {
    const onRecognizeGuide = vi.fn();
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" hasGuide={false} onRecognizeGuide={onRecognizeGuide} />);
    fireEvent.click(screen.getByText("Recognize Guide"));
    expect(onRecognizeGuide).toHaveBeenCalledTimes(1);
  });

  // ── Send to Chat / Implement buttons ──

  it("hides 'Send to Chat' and 'Implement' when no file saved", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile={null} />);
    expect(screen.queryByText("Send to Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Implement")).not.toBeInTheDocument();
  });

  it("shows 'Send to Chat' and 'Implement' when file is saved", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" />);
    expect(screen.getByText("Send to Chat")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
  });

  // ── Reset button ──

  it("always renders Reset (fresh project must be able to clear leaked state)", () => {
    render(<SpecWriterToolbar {...baseProps} />);
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("Reset stays visible after messages exist", () => {
    render(<SpecWriterToolbar {...baseProps} lastSavedFile="spec.md" />);
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("invokes onReset when Reset is clicked", () => {
    const onReset = vi.fn();
    render(<SpecWriterToolbar {...baseProps} onReset={onReset} />);
    fireEvent.click(screen.getByText("Reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("disables Reset while streaming", () => {
    render(<SpecWriterToolbar {...baseProps} isStreaming={true} />);
    const button = screen.getByText("Reset").closest("button");
    expect(button).toBeDisabled();
  });

  // ── Suggest Features ──

  it("shows Suggest Features only in feature mode", () => {
    render(<SpecWriterToolbar {...baseProps} conversationMode="feature" />);
    expect(screen.getByText("Suggest Features")).toBeInTheDocument();
  });

  it("hides Suggest Features in new_application mode", () => {
    render(<SpecWriterToolbar {...baseProps} conversationMode="new_application" />);
    expect(screen.queryByText("Suggest Features")).not.toBeInTheDocument();
  });
});
