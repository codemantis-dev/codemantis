import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickCommandsTab from "./QuickCommandsTab";

describe("QuickCommandsTab", () => {
  const defaultProps = {
    commands: [
      { label: "Build", command: "pnpm build" },
      { label: "Test", command: "pnpm test" },
    ],
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    expect(screen.getByText("Quick Commands")).toBeInTheDocument();
  });

  it("renders existing commands", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    expect(screen.getByDisplayValue("Build")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pnpm build")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pnpm test")).toBeInTheDocument();
  });

  it("renders '+ Add command' button", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    expect(screen.getByText("+ Add command")).toBeInTheDocument();
  });

  it("calls onChange with new command when '+ Add command' is clicked", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    fireEvent.click(screen.getByText("+ Add command"));
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      ...defaultProps.commands,
      { label: "", command: "" },
    ]);
  });

  it("calls onChange when a label is updated", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    fireEvent.change(screen.getByDisplayValue("Build"), { target: { value: "Deploy" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      { label: "Deploy", command: "pnpm build" },
      { label: "Test", command: "pnpm test" },
    ]);
  });

  it("calls onChange when a command is updated", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    fireEvent.change(screen.getByDisplayValue("pnpm build"), { target: { value: "npm run build" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      { label: "Build", command: "npm run build" },
      { label: "Test", command: "pnpm test" },
    ]);
  });

  it("removes a command when the remove button is clicked", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    // The X buttons to remove commands
    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.textContent === "\u00d7"
    );
    fireEvent.click(removeButtons[0]);
    expect(defaultProps.onChange).toHaveBeenCalledWith([
      { label: "Test", command: "pnpm test" },
    ]);
  });

  it("renders description text", () => {
    render(<QuickCommandsTab {...defaultProps} />);
    expect(screen.getByText("Commands available in the terminal toolbar for quick execution.")).toBeInTheDocument();
  });
});
