import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DetectionPrompt from "./DetectionPrompt";

describe("DetectionPrompt", () => {
  it("renders the consent copy with both transparency points", () => {
    render(<DetectionPrompt open onChoose={() => {}} />);
    // "What we check" — what's scanned
    expect(screen.getByText(/What we check/i)).toBeInTheDocument();
    // "What we don't do" — guarantees
    expect(screen.getByText(/What we don't do/i)).toBeInTheDocument();
  });

  it("calls onChoose(true) when Run detection is clicked", () => {
    const onChoose = vi.fn();
    render(<DetectionPrompt open onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /Run detection/ }));
    expect(onChoose).toHaveBeenCalledWith(true);
  });

  it("calls onChoose(false) when Skip detection is clicked", () => {
    const onChoose = vi.fn();
    render(<DetectionPrompt open onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: /Skip detection/ }));
    expect(onChoose).toHaveBeenCalledWith(false);
  });

  it("does NOT silently consent when the modal is closed via overlay/escape", () => {
    // Closing the modal counts as skip, never as yes — the user must
    // explicitly click "Run detection" to opt in.
    const onChoose = vi.fn();
    render(<DetectionPrompt open onChoose={onChoose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Either Skip-via-Escape produced a false call, or no call at all —
    // never a silent true.
    const yesCalls = onChoose.mock.calls.filter((args) => args[0] === true);
    expect(yesCalls).toHaveLength(0);
  });
});
