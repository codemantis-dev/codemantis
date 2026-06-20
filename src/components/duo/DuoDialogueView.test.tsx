import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DuoDialogueView from "./DuoDialogueView";
import { useDuoStore } from "../../stores/duoStore";
import { resetAllStores } from "../../test/helpers/store-reset";
import type { DuoDialogueTurn } from "../../types/duo";

function setDialogue(turns: DuoDialogueTurn[]): void {
  useDuoStore.setState({ dialogue: turns });
}

describe("DuoDialogueView", () => {
  beforeEach(() => resetAllStores());

  it("shows an empty state with no conversation", () => {
    render(<DuoDialogueView />);
    expect(screen.getByText(/Waiting for the first turn/i)).toBeInTheDocument();
  });

  it("renders a primary work turn and a mentor review with verdict chips", () => {
    setDialogue([
      { id: "1", round: 1, author: "primary", stance: "work", text: "I added the logout button", ts: 1 },
      {
        id: "2", round: 1, author: "duo", stance: "review", text: "Looks correct", ts: 2,
        verdict: { stance: "agree", severity: "nit", confidence: 0.92, ranBuild: true, ranTests: true },
      },
    ]);
    render(<DuoDialogueView />);
    expect(screen.getByText("I added the logout button")).toBeInTheDocument();
    expect(screen.getByText("Looks correct")).toBeInTheDocument();
    expect(screen.getByText("Primary · round 1")).toBeInTheDocument();
    expect(screen.getByText("Mentor · round 1")).toBeInTheDocument();
    // Verdict chips
    expect(screen.getByText("agree")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getByText("tests")).toBeInTheDocument();
    expect(screen.getByText("92% conf")).toBeInTheDocument();
  });

  it("renders the mentor's run-results when present", () => {
    setDialogue([
      {
        id: "1", round: 1, author: "duo", stance: "review", text: "Missing tests", ts: 1,
        verdict: { stance: "concern", severity: "blocking", confidence: 0.7, ranBuild: true, ranTests: false, checkResults: "2 failing specs" },
      },
    ]);
    render(<DuoDialogueView />);
    expect(screen.getByText("2 failing specs")).toBeInTheDocument();
  });

  it("renders system outcome markers (repair, resolve, decision)", () => {
    setDialogue([
      { id: "1", round: 1, author: "system", stance: "repair", text: "Mentor directed a repair (round 1): add tests", ts: 1 },
      { id: "2", round: 1, author: "system", stance: "resolve", text: "Agreement reached — primary's work accepted.", ts: 2 },
      { id: "3", round: 1, author: "system", stance: "decision", text: "Tie-break: mentor wins — primary must comply.", ts: 3 },
    ]);
    render(<DuoDialogueView />);
    expect(screen.getByText(/Mentor directed a repair/)).toBeInTheDocument();
    expect(screen.getByText(/Agreement reached/)).toBeInTheDocument();
    expect(screen.getByText(/Tie-break: mentor wins/)).toBeInTheDocument();
  });

  it("expands a long primary turn on demand", () => {
    const longText = "x".repeat(400);
    setDialogue([{ id: "1", round: 1, author: "primary", stance: "work", text: longText, ts: 1 }]);
    render(<DuoDialogueView />);
    expect(screen.getByText("show more")).toBeInTheDocument();
    fireEvent.click(screen.getByText("show more"));
    expect(screen.getByText("show less")).toBeInTheDocument();
  });
});
