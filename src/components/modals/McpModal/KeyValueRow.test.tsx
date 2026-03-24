import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import KeyValueRow from "./KeyValueRow";

describe("KeyValueRow", () => {
  const defaultProps = {
    label: "Environment Variables",
    pairs: [
      { key: "API_KEY", value: "secret123" },
      { key: "PORT", value: "3000" },
    ],
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the label", () => {
    render(<KeyValueRow {...defaultProps} />);
    expect(screen.getByText("Environment Variables")).toBeInTheDocument();
  });

  it("renders key-value pairs", () => {
    render(<KeyValueRow {...defaultProps} />);
    expect(screen.getByDisplayValue("API_KEY")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PORT")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3000")).toBeInTheDocument();
  });

  it("renders help text when provided", () => {
    render(<KeyValueRow {...defaultProps} helpText="Passed to the server process" />);
    expect(screen.getByText("Passed to the server process")).toBeInTheDocument();
  });

  it("calls onChange when adding a new pair", () => {
    render(<KeyValueRow {...defaultProps} />);
    fireEvent.click(screen.getByText("+ Add environment variable"));
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      ...defaultProps.pairs,
      { key: "", value: "" },
    ]);
  });

  it("calls onChange when removing a pair", () => {
    render(<KeyValueRow {...defaultProps} />);
    // There should be two remove buttons (X icons)
    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => !btn.textContent?.includes("+ Add")
    );
    // Click the first remove button to remove the first pair
    fireEvent.click(removeButtons[0]);
    expect(defaultProps.onChange).toHaveBeenCalledWith([defaultProps.pairs[1]]);
  });

  it("masks values when maskValues is true", () => {
    render(<KeyValueRow {...defaultProps} maskValues />);
    const valueInputs = screen.getAllByDisplayValue("secret123");
    // Password inputs will be rendered as type="password"
    expect(valueInputs[0]).toHaveAttribute("type", "password");
  });

  it("shows reveal toggle buttons when maskValues is true", () => {
    render(<KeyValueRow {...defaultProps} maskValues />);
    // Should have two toggle buttons (one per pair)
    const toggleButtons = screen.getAllByRole("button").filter(
      (btn) => !btn.textContent?.includes("+ Add") && !btn.querySelector("svg[class*='X']")
    );
    expect(toggleButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onChange when key is changed", () => {
    render(<KeyValueRow {...defaultProps} />);
    const keyInput = screen.getByDisplayValue("API_KEY");
    fireEvent.change(keyInput, { target: { value: "NEW_KEY" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      { key: "NEW_KEY", value: "secret123" },
      { key: "PORT", value: "3000" },
    ]);
  });
});
