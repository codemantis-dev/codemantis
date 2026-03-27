import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SuperBroTab from "./SuperBroTab";

describe("SuperBroTab", () => {
  const defaultProps = {
    enabled: true,
    provider: "auto",
    model: "auto",
    onEnabledChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModelChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders enable toggle", () => {
    render(<SuperBroTab {...defaultProps} />);
    expect(screen.getByText("Enable Super-Bro")).toBeInTheDocument();
  });

  it("shows provider/model selectors when enabled", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} />);
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("hides provider/model selectors when disabled", () => {
    render(<SuperBroTab {...defaultProps} enabled={false} />);
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });

  it("shows info text about Super-Bro being read-only", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} />);
    expect(
      screen.getByText(/never modifies files or runs commands/),
    ).toBeInTheDocument();
  });

  it("provider change callback fires", () => {
    render(<SuperBroTab {...defaultProps} enabled={true} provider="auto" />);
    const providerSelect = screen.getByDisplayValue("Auto (cheapest available)");
    fireEvent.change(providerSelect, { target: { value: "gemini" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("gemini");
    // Should also reset model to "auto" when provider changes
    expect(defaultProps.onModelChange).toHaveBeenCalledWith("auto");
  });

  it("model change callback fires", () => {
    render(
      <SuperBroTab
        {...defaultProps}
        enabled={true}
        provider="gemini"
        model="gemini-2.5-flash-lite"
      />,
    );
    const modelSelect = screen.getByDisplayValue("Gemini 2.5 Flash Lite");
    fireEvent.change(modelSelect, {
      target: { value: "gemini-2.5-flash" },
    });
    expect(defaultProps.onModelChange).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  it("toggle callback fires", () => {
    render(<SuperBroTab {...defaultProps} enabled={false} />);
    // The toggle button is inside the FieldRow for "Enable Super-Bro"
    const toggleButton = screen.getByRole("button");
    fireEvent.click(toggleButton);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });
});
