import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SelfDriveDecisionCard from "./SelfDriveDecisionCard";

function makeEvent(overrides: Partial<{
  action: string;
  summary: string;
  confidence: string;
  sessionIndex: number;
  phase: string;
}> = {}) {
  return {
    action: "advance",
    summary: "All checks passed.",
    confidence: "high",
    sessionIndex: 1,
    phase: "verifying",
    ...overrides,
  };
}

describe("SelfDriveDecisionCard", () => {
  it("renders summary text with Self-Drive prefix", () => {
    render(
      <SelfDriveDecisionCard
        event={makeEvent({ summary: "All checks passed." })}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    expect(screen.getByText(/Self-Drive: All checks passed\./)).toBeTruthy();
  });

  it("renders center-aligned with pill shape", () => {
    const { container } = render(
      <SelfDriveDecisionCard
        event={makeEvent()}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("justify-center");

    const pill = wrapper.firstElementChild as HTMLElement;
    expect(pill.className).toContain("rounded-full");
  });

  it("uses green styling for advance action", () => {
    const { container } = render(
      <SelfDriveDecisionCard
        event={makeEvent({ action: "advance" })}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill.style.background).toContain("34, 197, 94");
  });

  it("uses yellow styling for fix action", () => {
    const { container } = render(
      <SelfDriveDecisionCard
        event={makeEvent({ action: "fix", summary: "Fixing errors" })}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill.style.background).toContain("234, 179, 8");
  });

  it("uses red styling for abort action", () => {
    const { container } = render(
      <SelfDriveDecisionCard
        event={makeEvent({ action: "abort", summary: "Critical failure" })}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    const pill = container.querySelector(".rounded-full") as HTMLElement;
    expect(pill.style.background).toContain("239, 68, 68");
  });

  it("shows formatted timestamp", () => {
    render(
      <SelfDriveDecisionCard
        event={makeEvent()}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    // Timestamp should be rendered (exact format depends on locale)
    const spans = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(spans.length).toBeGreaterThan(0);
  });

  it("handles unknown action with default styling", () => {
    const { container } = render(
      <SelfDriveDecisionCard
        event={makeEvent({ action: "unknown_action" })}
        timestamp="2026-01-01T12:30:00Z"
      />,
    );

    const pill = container.querySelector(".rounded-full") as HTMLElement;
    // Default style uses accent color (indigo)
    expect(pill.style.background).toContain("99, 102, 241");
  });
});
