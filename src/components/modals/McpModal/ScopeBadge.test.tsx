import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScopeBadge from "./ScopeBadge";

describe("ScopeBadge", () => {
  it("renders 'Global' text for global scope", () => {
    render(<ScopeBadge scope="global" />);
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("renders 'Project' text for project scope", () => {
    render(<ScopeBadge scope="project" />);
    expect(screen.getByText("Project")).toBeInTheDocument();
  });

  it("applies different styling for global scope", () => {
    const { container } = render(<ScopeBadge scope="global" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-bg-elevated");
  });

  it("applies accent styling for project scope", () => {
    const { container } = render(<ScopeBadge scope="project" />);
    const badge = container.querySelector("span");
    expect(badge?.className).toContain("text-accent");
  });
});
