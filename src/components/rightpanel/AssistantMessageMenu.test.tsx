import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantMessageMenu from "./AssistantMessageMenu";

// Mock useClickOutside — return a plain ref
vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: () => ({ current: null }),
}));

// Mock uiStore
vi.mock("../../stores/uiStore", () => ({
  useUiStore: Object.assign(
    vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({})),
    {
      getState: vi.fn(() => ({
        setDraftInput: vi.fn(),
      })),
    }
  ),
}));

describe("AssistantMessageMenu", () => {
  const defaultProps = {
    x: 100,
    y: 200,
    messageText: "Hello world",
    onClose: vi.fn(),
    onAddShortcut: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders all three menu items", () => {
    render(<AssistantMessageMenu {...defaultProps} />);
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Use in Chat")).toBeInTheDocument();
    expect(screen.getByText("Add as Shortcut")).toBeInTheDocument();
  });

  it("copies text and closes on Copy click", () => {
    const onClose = vi.fn();
    render(<AssistantMessageMenu {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hello world");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onAddShortcut with message text on Add as Shortcut click", () => {
    const onAddShortcut = vi.fn();
    const onClose = vi.fn();
    render(
      <AssistantMessageMenu
        {...defaultProps}
        onAddShortcut={onAddShortcut}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText("Add as Shortcut"));
    expect(onAddShortcut).toHaveBeenCalledWith("Hello world");
    expect(onClose).toHaveBeenCalled();
  });

  it("clamps position to prevent viewport overflow", () => {
    // Render near edge of screen
    const { container } = render(
      <AssistantMessageMenu {...defaultProps} x={9999} y={9999} />
    );
    const menu = container.firstChild as HTMLElement;
    // The position should be clamped so it doesn't exceed viewport
    const left = parseInt(menu.style.left);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
  });
});
