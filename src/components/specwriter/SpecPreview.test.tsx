import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecPreview from "./SpecPreview";

describe("SpecPreview", () => {
  it("renders empty state when no content", () => {
    render(<SpecPreview content={null} />);
    expect(screen.getByText("Spec Preview")).toBeTruthy();
    expect(screen.getByText(/start a conversation/i)).toBeTruthy();
  });

  it("renders spec content as markdown", () => {
    render(<SpecPreview content={"# Hello World"} />);
    // Title bar and h1 both show the heading — at least one should exist
    expect(screen.getAllByText("Hello World").length).toBeGreaterThanOrEqual(1);
  });

  it("does not show tab bar when only spec exists", () => {
    render(<SpecPreview content="# Spec" />);
    expect(screen.queryByText("Specification")).toBeNull();
    expect(screen.queryByText("Verification Audit")).toBeNull();
  });

  it("shows tab bar when both spec and audit exist", () => {
    render(<SpecPreview content="# Spec" auditContent="# Audit" />);
    expect(screen.getByText("Specification")).toBeTruthy();
    expect(screen.getByText("Verification Audit")).toBeTruthy();
  });

  it("auto-switches to audit tab when audit content appears", () => {
    const { rerender } = render(<SpecPreview content="# Spec Only" />);
    // Only spec, no tabs
    expect(screen.queryByText("Verification Audit")).toBeNull();

    // Now add audit content — component should auto-switch to audit tab
    rerender(<SpecPreview content="# Spec Only" auditContent="# Audit Doc" />);
    // Tab bar should appear
    expect(screen.getByText("Verification Audit")).toBeTruthy();
    expect(screen.getByText("Specification")).toBeTruthy();
    // Audit content title visible (title bar + markdown h1)
    expect(screen.getAllByText("Audit Doc").length).toBeGreaterThanOrEqual(1);
  });

  it("switches between spec and audit tabs", () => {
    render(
      <SpecPreview
        content="# SpecTitle"
        auditContent="# AuditTitle"
      />
    );
    // Should start on audit tab (auto-switched)
    expect(screen.getAllByText("AuditTitle").length).toBeGreaterThanOrEqual(1);

    // Click Specification tab — should show spec content
    fireEvent.click(screen.getByText("Specification"));
    expect(screen.getAllByText("SpecTitle").length).toBeGreaterThanOrEqual(1);

    // Click Verification Audit tab to go back
    fireEvent.click(screen.getByText("Verification Audit"));
    expect(screen.getAllByText("AuditTitle").length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state when neither spec nor audit content", () => {
    render(<SpecPreview content={null} auditContent={null} />);
    expect(screen.getByText("Spec Preview")).toBeTruthy();
  });

  it("does not crash when only audit exists (no spec)", () => {
    render(<SpecPreview content={null} auditContent="# AuditOnly" />);
    // Should not show empty state since auditContent exists
    expect(screen.queryByText("Spec Preview")).toBeNull();
    // Should render audit content (auto-switched to audit tab)
    expect(screen.getAllByText("AuditOnly").length).toBeGreaterThanOrEqual(1);
  });

  it("hides tab bar when only audit exists (no spec)", () => {
    render(<SpecPreview content={null} auditContent="# Solo" />);
    // hasBothDocuments is false — no tab bar
    expect(screen.queryByText("Specification")).toBeNull();
    // The tab button "Verification Audit" should not appear
    // (only the title bar content and rendered markdown)
  });
});
