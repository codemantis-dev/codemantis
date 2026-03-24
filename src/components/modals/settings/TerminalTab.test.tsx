import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TerminalTab from "./TerminalTab";

describe("TerminalTab", () => {
  const defaultProps = {
    shell: "/bin/zsh",
    fontSize: 13,
    onShellChange: vi.fn(),
    onFontSizeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<TerminalTab {...defaultProps} />);
    expect(screen.getByText("Terminal")).toBeInTheDocument();
  });

  it("renders Shell field with current value", () => {
    render(<TerminalTab {...defaultProps} />);
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/bin/zsh")).toBeInTheDocument();
  });

  it("renders Font Size field with current value", () => {
    render(<TerminalTab {...defaultProps} />);
    expect(screen.getByText("Font Size")).toBeInTheDocument();
    expect(screen.getByDisplayValue("13")).toBeInTheDocument();
  });

  it("calls onShellChange when shell input changes", () => {
    render(<TerminalTab {...defaultProps} />);
    fireEvent.change(screen.getByDisplayValue("/bin/zsh"), { target: { value: "/bin/bash" } });
    expect(defaultProps.onShellChange).toHaveBeenCalledWith("/bin/bash");
  });

  it("calls onFontSizeChange when font size changes", () => {
    render(<TerminalTab {...defaultProps} />);
    fireEvent.change(screen.getByDisplayValue("13"), { target: { value: "15" } });
    expect(defaultProps.onFontSizeChange).toHaveBeenCalledWith(15);
  });

  it("has placeholder for shell input", () => {
    render(<TerminalTab {...defaultProps} shell="" />);
    expect(screen.getByPlaceholderText("Default ($SHELL)")).toBeInTheDocument();
  });
});
