import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import StreamingCursor from "./StreamingCursor";

describe("StreamingCursor", () => {
  it("renders without crashing", () => {
    const { container } = render(<StreamingCursor />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders a span element with blink animation class", () => {
    const { container } = render(<StreamingCursor />);
    const span = container.querySelector("span");
    expect(span).toBeTruthy();
    expect(span?.className).toContain("animate-blink");
  });

  it("has correct inline styles for width and height", () => {
    const { container } = render(<StreamingCursor />);
    const span = container.querySelector("span");
    expect(span?.style.width).toBe("2px");
    expect(span?.style.height).toBe("1.1em");
  });

  it("uses accent-light background color from CSS variable", () => {
    const { container } = render(<StreamingCursor />);
    const span = container.querySelector("span");
    expect(span?.style.backgroundColor).toBe("var(--accent-light)");
  });
});
