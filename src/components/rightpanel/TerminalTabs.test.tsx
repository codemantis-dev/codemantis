import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TerminalTabs from "./TerminalTabs";
import type { TerminalInstance } from "../../types/terminal";

function makeTerminal(overrides?: Partial<TerminalInstance>): TerminalInstance {
  return {
    id: "t1",
    sessionId: "s1",
    name: "bash",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    isRunning: true,
    ...overrides,
  };
}

describe("TerminalTabs", () => {
  const defaultProps = {
    terminals: [makeTerminal()],
    activeTerminalId: "t1",
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onCreate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders terminal tab with name", () => {
    render(<TerminalTabs {...defaultProps} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
  });

  it("calls onSelect when tab clicked", () => {
    const onSelect = vi.fn();
    render(<TerminalTabs {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("bash"));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("calls onClose when X clicked (stops propagation)", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <TerminalTabs {...defaultProps} onClose={onClose} onSelect={onSelect} />
    );
    // The X icon is inside a span; find the close span
    const closeSpans = document.querySelectorAll("[class*='group-hover']");
    fireEvent.click(closeSpans[0]);
    expect(onClose).toHaveBeenCalledWith("t1");
    // Should not trigger onSelect due to stopPropagation
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onCreate when + button clicked", () => {
    const onCreate = vi.fn();
    render(<TerminalTabs {...defaultProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByTitle("New terminal"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("renders multiple terminal tabs", () => {
    render(
      <TerminalTabs
        {...defaultProps}
        terminals={[
          makeTerminal({ id: "t1", name: "bash" }),
          makeTerminal({ id: "t2", name: "node", isRunning: false }),
        ]}
      />
    );
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
  });

  it("highlights active terminal tab", () => {
    render(
      <TerminalTabs
        {...defaultProps}
        terminals={[
          makeTerminal({ id: "t1", name: "bash" }),
          makeTerminal({ id: "t2", name: "node" }),
        ]}
        activeTerminalId="t1"
      />
    );
    const bashTab = screen.getByText("bash").closest("button");
    expect(bashTab!.className).toContain("bg-bg-elevated");
    const nodeTab = screen.getByText("node").closest("button");
    expect(nodeTab!.className).not.toContain("bg-bg-elevated");
  });
});
