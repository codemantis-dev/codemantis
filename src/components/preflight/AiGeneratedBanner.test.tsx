import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AiGeneratedBanner from "./AiGeneratedBanner";

describe("AiGeneratedBanner", () => {
  it("shows the un-verified copy when crossVerified is false", () => {
    render(<AiGeneratedBanner />);
    expect(screen.getByText(/haven't been verified/i)).toBeInTheDocument();
  });

  it("shows the cross-verified copy when crossVerified is true", () => {
    render(<AiGeneratedBanner crossVerified />);
    expect(screen.getByText(/Two other AI providers confirmed/i)).toBeInTheDocument();
  });

  it("always reminds the user to double-check", () => {
    const { rerender } = render(<AiGeneratedBanner />);
    expect(screen.getByText(/Double-check/i)).toBeInTheDocument();
    rerender(<AiGeneratedBanner crossVerified />);
    expect(screen.getByText(/Double-check/i)).toBeInTheDocument();
  });
});
