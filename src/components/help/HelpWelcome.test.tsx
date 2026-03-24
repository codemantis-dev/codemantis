import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HelpWelcome from "./HelpWelcome";

describe("HelpWelcome", () => {
  it("renders welcome message", () => {
    render(<HelpWelcome onSuggestionClick={vi.fn()} />);
    expect(screen.getByText("Welcome! I'm your CodeMantis helper.")).toBeInTheDocument();
  });

  it("renders all suggestion buttons", () => {
    render(<HelpWelcome onSuggestionClick={vi.fn()} />);
    expect(screen.getByText(/How do I create a new project/)).toBeInTheDocument();
    expect(screen.getByText(/What are the three session modes/)).toBeInTheDocument();
    expect(screen.getByText(/How do I connect an MCP server/)).toBeInTheDocument();
    expect(screen.getByText(/How do I use SpecWriter/)).toBeInTheDocument();
    expect(screen.getByText(/What keyboard shortcuts are available/)).toBeInTheDocument();
  });

  it("calls onSuggestionClick with the suggestion text when clicked", () => {
    const onClick = vi.fn();
    render(<HelpWelcome onSuggestionClick={onClick} />);
    fireEvent.click(screen.getByText(/How do I create a new project/));
    expect(onClick).toHaveBeenCalledWith("How do I create a new project from a template?");
  });

  it("renders five suggestion buttons", () => {
    render(<HelpWelcome onSuggestionClick={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(5);
  });

  it("displays descriptive subtitle text", () => {
    render(<HelpWelcome onSuggestionClick={vi.fn()} />);
    expect(
      screen.getByText(/I know every feature, shortcut, and setting/)
    ).toBeInTheDocument();
  });
});
