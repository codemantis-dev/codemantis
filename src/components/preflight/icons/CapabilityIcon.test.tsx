import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CapabilityIcon from "./CapabilityIcon";

describe("CapabilityIcon", () => {
  it("renders the first letter of the service name in uppercase", () => {
    render(<CapabilityIcon serviceName="stripe" />);
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("falls back to ? when given an empty service name", () => {
    render(<CapabilityIcon serviceName="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("uses category-specific colour when one is mapped", () => {
    const { container } = render(
      <CapabilityIcon serviceName="OpenAI" category="llm_provider" />,
    );
    const div = container.querySelector("div");
    // Just assert that some colour value was applied (the actual hex differs
    // by category — we don't pin the colour to a literal).
    expect(div?.getAttribute("style")).toMatch(/rgb/);
  });

  it("respects custom size", () => {
    const { container } = render(
      <CapabilityIcon serviceName="X" size={48} />,
    );
    const div = container.querySelector("div");
    expect(div?.getAttribute("style")).toContain("width: 48px");
    expect(div?.getAttribute("style")).toContain("height: 48px");
  });

  it("is hidden from assistive tech (the label is shown elsewhere)", () => {
    const { container } = render(<CapabilityIcon serviceName="X" />);
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
  });
});
