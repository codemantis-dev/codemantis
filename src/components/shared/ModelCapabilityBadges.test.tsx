import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ModelCapabilityBadges from "./ModelCapabilityBadges";
import type { OpenRouterModel } from "../../types/assistant-provider";

function makeModel(overrides?: Partial<OpenRouterModel>): OpenRouterModel {
  return {
    id: "test/model-1",
    name: "Test Model",
    isFree: false,
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextLength: 128000,
    pricing: { input: 1.0, output: 2.0 },
    ...overrides,
  };
}

describe("ModelCapabilityBadges", () => {
  it("renders vision badge when image modality is supported", () => {
    render(<ModelCapabilityBadges model={makeModel({ inputModalities: ["text", "image"] })} />);
    expect(screen.getByText("IMG")).toBeInTheDocument();
    expect(screen.getByTitle("Supports image inputs")).toBeInTheDocument();
  });

  it("renders file badge when file modality is supported", () => {
    render(<ModelCapabilityBadges model={makeModel({ inputModalities: ["text", "file"] })} />);
    expect(screen.getByText("DOC")).toBeInTheDocument();
    expect(screen.getByTitle("Supports file/document inputs")).toBeInTheDocument();
  });

  it("renders nothing for text-only model with no special capabilities", () => {
    const { container } = render(<ModelCapabilityBadges model={makeModel()} />);
    // The span wrapper is always rendered, but it should have no child badge spans
    expect(screen.queryByText("IMG")).not.toBeInTheDocument();
    expect(screen.queryByText("DOC")).not.toBeInTheDocument();
    expect(screen.queryByText("F")).not.toBeInTheDocument();
    // Only the outer wrapper span should exist
    const outerSpan = container.firstChild as HTMLElement;
    expect(outerSpan.children).toHaveLength(0);
  });
});
