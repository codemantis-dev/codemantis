import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BranchCoachTip from "./BranchCoachTip";
import { isCoachTipDismissed } from "../../lib/branchmap/coach-storage";

beforeEach(() => {
  localStorage.clear();
});

describe("BranchCoachTip", () => {
  it("shows on first visit and hides + persists after dismissal", () => {
    const { rerender } = render(
      <BranchCoachTip tipKey="intro" title="Learn branches">
        body text
      </BranchCoachTip>,
    );
    expect(screen.getByTestId("branch-coach-tip")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Got it/i }));
    expect(screen.queryByTestId("branch-coach-tip")).not.toBeInTheDocument();
    expect(isCoachTipDismissed("intro")).toBe(true);

    // A fresh mount stays hidden (persisted).
    rerender(
      <BranchCoachTip tipKey="intro" title="Learn branches">
        body text
      </BranchCoachTip>,
    );
    expect(screen.queryByTestId("branch-coach-tip")).not.toBeInTheDocument();
  });

  it("stays hidden when already dismissed before mount", () => {
    localStorage.setItem("branchmap.coach.intro", "1");
    render(
      <BranchCoachTip tipKey="intro" title="x">
        y
      </BranchCoachTip>,
    );
    expect(screen.queryByTestId("branch-coach-tip")).not.toBeInTheDocument();
  });

  it("keys are independent", () => {
    localStorage.setItem("branchmap.coach.intro", "1");
    expect(isCoachTipDismissed("intro")).toBe(true);
    expect(isCoachTipDismissed("other")).toBe(false);
  });
});
