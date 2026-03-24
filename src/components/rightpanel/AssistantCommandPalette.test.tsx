import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantCommandPalette from "./AssistantCommandPalette";
import type { SlashCommand } from "../../types/slash-commands";
import React from "react";

function makeCommand(overrides?: Partial<SlashCommand>): SlashCommand {
  return {
    name: "help",
    description: "Show available commands",
    category: "built-in",
    source_path: null,
    argument_hint: null,
    model: null,
    user_invocable: true,
    ...overrides,
  };
}

describe("AssistantCommandPalette", () => {
  const defaultProps = {
    commands: [
      makeCommand({ name: "help", description: "Show available commands" }),
      makeCommand({ name: "clear", description: "Clear conversation" }),
    ],
    commandIndex: 0,
    onSelect: vi.fn(),
    onHover: vi.fn(),
    commandPaletteRef: React.createRef<HTMLDivElement>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when commands array is empty", () => {
    const { container } = render(
      <AssistantCommandPalette {...defaultProps} commands={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders command names with / prefix", () => {
    render(<AssistantCommandPalette {...defaultProps} />);
    expect(screen.getByText("/help")).toBeInTheDocument();
    expect(screen.getByText("/clear")).toBeInTheDocument();
  });

  it("renders command descriptions", () => {
    render(<AssistantCommandPalette {...defaultProps} />);
    expect(screen.getByText("Show available commands")).toBeInTheDocument();
    expect(screen.getByText("Clear conversation")).toBeInTheDocument();
  });

  it("highlights the active command index", () => {
    const { rerender } = render(
      <AssistantCommandPalette {...defaultProps} commandIndex={0} />
    );
    const buttons = screen.getAllByRole("button");
    // Active item has exact "bg-bg-subtle" (not hover:bg-bg-subtle/50)
    expect(buttons[0].className).toMatch(/(?<![:\w])bg-bg-subtle(?!\/)/);
    expect(buttons[1].className).not.toMatch(/(?<![:\w])bg-bg-subtle(?!\/)/);

    rerender(<AssistantCommandPalette {...defaultProps} commandIndex={1} />);
    const updatedButtons = screen.getAllByRole("button");
    expect(updatedButtons[0].className).not.toMatch(/(?<![:\w])bg-bg-subtle(?!\/)/);
    expect(updatedButtons[1].className).toMatch(/(?<![:\w])bg-bg-subtle(?!\/)/);
  });

  it("calls onSelect when command clicked", () => {
    const onSelect = vi.fn();
    render(<AssistantCommandPalette {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("/help"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "help" })
    );
  });

  it("calls onHover when mouse enters a command", () => {
    const onHover = vi.fn();
    render(<AssistantCommandPalette {...defaultProps} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getAllByRole("button")[1]);
    expect(onHover).toHaveBeenCalledWith(1);
  });
});
