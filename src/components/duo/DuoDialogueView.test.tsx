import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DuoDialogueView from "./DuoDialogueView";
import { useDuoStore } from "../../stores/duoStore";
import { resetAllStores } from "../../test/helpers/store-reset";

describe("DuoDialogueView", () => {
  beforeEach(() => resetAllStores());

  it("shows an empty state with no dialogue", () => {
    render(<DuoDialogueView />);
    expect(screen.getByText(/No dialogue yet/i)).toBeInTheDocument();
  });

  it("renders mentor and primary turns with stance + round", () => {
    useDuoStore.setState({
      dialogue: [
        { id: "1", round: 1, author: "duo", stance: "concern", text: "missing tests", ts: 1 },
        { id: "2", round: 1, author: "primary", stance: "defend", text: "covered upstream", ts: 2 },
      ],
    });
    render(<DuoDialogueView />);
    expect(screen.getByText("missing tests")).toBeInTheDocument();
    expect(screen.getByText("covered upstream")).toBeInTheDocument();
    expect(screen.getByText(/Mentor · round 1/)).toBeInTheDocument();
    expect(screen.getByText(/Primary · round 1/)).toBeInTheDocument();
    expect(screen.getByText("concern")).toBeInTheDocument();
    expect(screen.getByText("defend")).toBeInTheDocument();
  });
});
