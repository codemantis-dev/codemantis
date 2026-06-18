import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DuoTieBreakModal from "./DuoTieBreakModal";
import { useDuoStore, type DuoBlocker } from "../../stores/duoStore";
import { resetAllStores } from "../../test/helpers/store-reset";

const DEADLOCK: DuoBlocker = {
  kind: "duo-deadlock",
  summary: "Primary and mentor disagree on the approach",
  primaryPosition: "Keep the array",
  duoPosition: "Switch to a Map",
  repairTask: "Use a Map keyed by id",
};

describe("DuoTieBreakModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetAllStores();
  });

  it("renders nothing unless paused on a blocker", () => {
    const { container } = render(<DuoTieBreakModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows both positions and resolution actions for a deadlock", () => {
    useDuoStore.setState({ status: "paused", blocker: DEADLOCK });
    const resolve = vi.spyOn(useDuoStore.getState(), "resolveTieBreak").mockResolvedValue();
    render(<DuoTieBreakModal />);
    expect(screen.getByText(/disagree on the approach/i)).toBeInTheDocument();
    expect(screen.getByText("Keep the array")).toBeInTheDocument();
    expect(screen.getByText("Switch to a Map")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Let mentor win"));
    expect(resolve).toHaveBeenCalledWith("mentorWins");
    fireEvent.click(screen.getByText("Let primary proceed"));
    expect(resolve).toHaveBeenCalledWith("primaryWins");
  });

  it("shows budget-cap copy and hides the win/proceed buttons", () => {
    useDuoStore.setState({
      status: "paused",
      blocker: { ...DEADLOCK, summary: "Budget cap reached ($2.00, 5000 tokens)" },
    });
    render(<DuoTieBreakModal />);
    expect(screen.getByText("Budget cap reached ($2.00, 5000 tokens)")).toBeInTheDocument();
    expect(screen.queryByText("Let mentor win")).not.toBeInTheDocument();
    expect(screen.getByText("Stop the run")).toBeInTheDocument();
  });
});
