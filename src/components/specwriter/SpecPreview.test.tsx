import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecPreview from "./SpecPreview";

describe("SpecPreview", () => {
  const noop = vi.fn();

  it("renders empty state when no content", () => {
    render(<SpecPreview content={null} activeTab="spec" onTabChange={noop} />);
    expect(screen.getByText("Spec Preview")).toBeTruthy();
    expect(screen.getByText(/start a conversation/i)).toBeTruthy();
  });

  it("renders spec content as markdown", () => {
    render(<SpecPreview content={"# Hello World"} activeTab="spec" onTabChange={noop} />);
    // Title bar and h1 both show the heading — at least one should exist
    expect(screen.getAllByText("Hello World").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show tab bar when only spec exists", () => {
    render(<SpecPreview content="# Spec" activeTab="spec" onTabChange={noop} />);
    expect(screen.queryByText("Specification")).toBeNull();
    expect(screen.queryByText("Verification Audit")).toBeNull();
  });

  it("shows tab bar when both spec and audit exist", () => {
    render(<SpecPreview content="# Spec" auditContent="# Audit" activeTab="spec" onTabChange={noop} />);
    expect(screen.getByText("Specification")).toBeTruthy();
    expect(screen.getByText("Verification Audit")).toBeTruthy();
  });

  it("calls onTabChange when clicking tab buttons", () => {
    const onTabChange = vi.fn();
    render(
      <SpecPreview
        content="# SpecTitle"
        auditContent="# AuditTitle"
        activeTab="audit"
        onTabChange={onTabChange}
      />
    );

    fireEvent.click(screen.getByText("Specification"));
    expect(onTabChange).toHaveBeenCalledWith("spec");

    fireEvent.click(screen.getByText("Verification Audit"));
    expect(onTabChange).toHaveBeenCalledWith("audit");
  });

  it("displays audit content when activeTab is audit", () => {
    render(
      <SpecPreview
        content="# SpecTitle"
        auditContent="# AuditTitle"
        activeTab="audit"
        onTabChange={noop}
      />
    );
    expect(screen.getAllByText("AuditTitle").length).toBeGreaterThanOrEqual(1);
  });

  it("displays spec content when activeTab is spec", () => {
    render(
      <SpecPreview
        content="# SpecTitle"
        auditContent="# AuditTitle"
        activeTab="spec"
        onTabChange={noop}
      />
    );
    expect(screen.getAllByText("SpecTitle").length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state when neither spec nor audit content", () => {
    render(<SpecPreview content={null} auditContent={null} activeTab="spec" onTabChange={noop} />);
    expect(screen.getByText("Spec Preview")).toBeTruthy();
  });

  it("does not crash when only audit exists (no spec)", () => {
    render(<SpecPreview content={null} auditContent="# AuditOnly" activeTab="audit" onTabChange={noop} />);
    // Should not show empty state since auditContent exists
    expect(screen.queryByText("Spec Preview")).toBeNull();
    // Should render audit content
    expect(screen.getAllByText("AuditOnly").length).toBeGreaterThanOrEqual(1);
  });

  it("hides tab bar when only audit exists (no spec)", () => {
    render(<SpecPreview content={null} auditContent="# Solo" activeTab="audit" onTabChange={noop} />);
    // hasBothDocuments is false — no tab bar
    expect(screen.queryByText("Specification")).toBeNull();
  });
});
