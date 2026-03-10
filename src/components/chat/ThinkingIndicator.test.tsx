import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ThinkingIndicator from "./ThinkingIndicator";

// Mock the trivia data module to avoid loading the full dataset in tests
vi.mock("../../data/trivia", () => ({
  getRandomTrivia: () => ({
    topic: "Test Topic",
    fact: "A test trivia fact.",
    isEasterEgg: false,
  }),
  getRandomEasterEgg: () => ({
    topic: "Easter Egg",
    fact: "A secret fact.",
    isEasterEgg: true,
  }),
}));

describe("ThinkingIndicator", () => {
  it("renders the working indicator text", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText(/Claude is working/)).toBeInTheDocument();
  });

  it("renders trivia card with fact text", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText("A test trivia fact.")).toBeInTheDocument();
  });

  it("renders trivia card with topic badge", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText("Test Topic")).toBeInTheDocument();
  });

  it("renders 'Did you know?' header in trivia card", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByText(/Did you know/)).toBeInTheDocument();
  });
});
