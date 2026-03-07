import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StatusDot from "./StatusDot";

describe("StatusDot", () => {
  it("renders with default size", () => {
    const { container } = render(<StatusDot color="green" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.width).toBe("6px");
    expect(dot.style.height).toBe("6px");
  });

  it("renders with custom size", () => {
    const { container } = render(<StatusDot color="green" size={10} />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.width).toBe("10px");
    expect(dot.style.height).toBe("10px");
  });

  it("applies pulse animation class when pulsing", () => {
    const { container } = render(<StatusDot color="yellow" pulse />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.className).toContain("animate-pulse");
  });

  it("does not apply pulse class by default", () => {
    const { container } = render(<StatusDot color="red" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.className).not.toContain("animate-pulse");
  });

  it("renders for all color values without crashing", () => {
    const colors = ["green", "yellow", "red", "blue", "purple", "accent"] as const;
    for (const color of colors) {
      const { unmount } = render(<StatusDot color={color} />);
      unmount();
    }
  });
});
