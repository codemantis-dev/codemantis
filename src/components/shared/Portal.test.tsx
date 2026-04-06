import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Portal from "./Portal";

describe("Portal", () => {
  it("renders children into document.body", () => {
    render(
      <Portal>
        <div data-testid="portal-child">Hello from portal</div>
      </Portal>,
    );
    const child = screen.getByTestId("portal-child");
    expect(child).toBeInTheDocument();
    // The child should be a descendant of document.body, not nested inside the render container
    expect(document.body.contains(child)).toBe(true);
  });

  it("cleans up portal element on unmount", () => {
    const { unmount } = render(
      <Portal>
        <div data-testid="portal-cleanup">Temporary</div>
      </Portal>,
    );
    expect(screen.getByTestId("portal-cleanup")).toBeInTheDocument();
    unmount();
    expect(screen.queryByTestId("portal-cleanup")).not.toBeInTheDocument();
  });

  it("renders multiple children", () => {
    render(
      <Portal>
        <span>First child</span>
        <span>Second child</span>
      </Portal>,
    );
    expect(screen.getByText("First child")).toBeInTheDocument();
    expect(screen.getByText("Second child")).toBeInTheDocument();
  });
});
