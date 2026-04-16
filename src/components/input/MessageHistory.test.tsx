import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import MessageHistory, { type MessageHistoryHandle } from "./MessageHistory";

const sampleItems = [
  "first message",
  "second message",
  "third message",
  "most recent message",
];

describe("MessageHistory", () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all provided items", () => {
    render(<MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />);
    for (const item of sampleItems) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it("pre-selects the last item (most recent)", () => {
    render(<MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />);
    const lastButton = screen.getByText("most recent message").closest("button");
    expect(lastButton?.className).toContain("bg-bg-subtle");
  });

  it("calls onSelect with correct text when item is clicked", () => {
    render(<MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText("second message"));
    expect(onSelect).toHaveBeenCalledWith("second message");
  });

  it("calls onClose on click outside", () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });

  it("updates selection on mouse enter", () => {
    render(<MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />);
    fireEvent.mouseEnter(screen.getByText("first message").closest("button")!);
    const firstButton = screen.getByText("first message").closest("button");
    expect(firstButton?.className).toContain("bg-bg-subtle");
  });

  describe("keyboard navigation via handle", () => {
    it("ArrowUp moves selection up", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      // Initially last item selected; press up once
      ref.current!.handleKeyDown("ArrowUp");
      const thirdButton = screen.getByText("third message").closest("button");
      expect(thirdButton?.className).toContain("bg-bg-subtle");
    });

    it("ArrowDown does not go past the last item", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      // Already at last item; pressing down should stay
      ref.current!.handleKeyDown("ArrowDown");
      const lastButton = screen.getByText("most recent message").closest("button");
      expect(lastButton?.className).toContain("bg-bg-subtle");
    });

    it("ArrowUp does not go past the first item", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={["only item"]} onSelect={onSelect} onClose={onClose} />
      );
      ref.current!.handleKeyDown("ArrowUp");
      const button = screen.getByText("only item").closest("button");
      expect(button?.className).toContain("bg-bg-subtle");
    });

    it("Enter selects the current item", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      ref.current!.handleKeyDown("Enter");
      expect(onSelect).toHaveBeenCalledWith("most recent message");
    });

    it("Escape calls onClose", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      ref.current!.handleKeyDown("Escape");
      expect(onClose).toHaveBeenCalled();
    });

    it("returns false for unhandled keys", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      expect(ref.current!.handleKeyDown("a")).toBe(false);
      expect(ref.current!.handleKeyDown("Tab")).toBe(false);
    });

    it("returns true for handled keys", () => {
      const ref = createRef<MessageHistoryHandle>();
      render(
        <MessageHistory ref={ref} items={sampleItems} onSelect={onSelect} onClose={onClose} />
      );
      expect(ref.current!.handleKeyDown("ArrowUp")).toBe(true);
      expect(ref.current!.handleKeyDown("ArrowDown")).toBe(true);
      expect(ref.current!.handleKeyDown("Enter")).toBe(true);
      expect(ref.current!.handleKeyDown("Escape")).toBe(true);
    });
  });

  it("renders items in the provided order (oldest first, newest last)", () => {
    render(<MessageHistory items={sampleItems} onSelect={onSelect} onClose={onClose} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("first message");
    expect(buttons[buttons.length - 1]).toHaveTextContent("most recent message");
  });
});
