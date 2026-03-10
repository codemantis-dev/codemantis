import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TriviaCard from "./TriviaCard";

describe("TriviaCard", () => {
  it("renders topic and fact text", () => {
    render(
      <TriviaCard
        topic="Space"
        fact="The sun is a star."
        isEasterEgg={false}
        factKey={0}
      />,
    );
    expect(screen.getByText("Space")).toBeInTheDocument();
    expect(screen.getByText("The sun is a star.")).toBeInTheDocument();
  });

  it("shows 'Did you know?' header for regular facts", () => {
    render(
      <TriviaCard
        topic="Ocean"
        fact="Whales sing."
        isEasterEgg={false}
        factKey={0}
      />,
    );
    expect(screen.getByText(/Did you know/)).toBeInTheDocument();
  });

  it("shows 'Fun fact!' header for easter eggs", () => {
    render(
      <TriviaCard
        topic="Secret"
        fact="Hidden gem."
        isEasterEgg={true}
        factKey={0}
      />,
    );
    expect(screen.getByText(/Fun fact/)).toBeInTheDocument();
  });

  it("applies distinct border color for easter egg variant", () => {
    const { container } = render(
      <TriviaCard
        topic="Secret"
        fact="Hidden gem."
        isEasterEgg={true}
        factKey={0}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.borderColor).toBe("var(--yellow)");
  });
});
