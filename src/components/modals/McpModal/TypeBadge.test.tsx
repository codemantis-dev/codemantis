import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TypeBadge from "./TypeBadge";

describe("TypeBadge", () => {
  it("renders 'stdio' text for stdio type", () => {
    render(<TypeBadge type="stdio" />);
    expect(screen.getByText("stdio")).toBeInTheDocument();
  });

  it("renders 'http' text for http type", () => {
    render(<TypeBadge type="http" />);
    expect(screen.getByText("http")).toBeInTheDocument();
  });

  it("renders 'sse' text for sse type", () => {
    render(<TypeBadge type="sse" />);
    expect(screen.getByText("sse")).toBeInTheDocument();
  });

  it("applies blue styling for stdio type", () => {
    const { container } = render(<TypeBadge type="stdio" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("text-blue-400");
  });

  it("applies green styling for http type", () => {
    const { container } = render(<TypeBadge type="http" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("text-green-400");
  });

  it("applies purple styling for sse type", () => {
    const { container } = render(<TypeBadge type="sse" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("text-purple-400");
  });
});
