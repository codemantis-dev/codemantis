import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectTab from "./ProjectTab";
import { useSessionStore } from "../../stores/sessionStore";

vi.mock("../../lib/tauri-commands", () => ({}));

describe("ProjectTab", () => {
  const defaultProps = {
    projectPath: "/path/to/project",
    projectName: "MyProject",
    sessionCount: 1,
    isActive: false,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      tabOrder: [],
      sessions: new Map(),
      sessionBusy: new Map(),
      lastEventTimestamp: new Map(),
    });
  });

  it("renders project name", () => {
    render(<ProjectTab {...defaultProps} />);
    expect(screen.getByText("MyProject")).toBeInTheDocument();
  });

  it("shows session count badge when more than 1 session", () => {
    render(<ProjectTab {...defaultProps} sessionCount={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not show session count badge for a single session", () => {
    render(<ProjectTab {...defaultProps} sessionCount={1} />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    render(<ProjectTab {...defaultProps} />);
    fireEvent.click(screen.getByText("MyProject"));
    expect(defaultProps.onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows close button when active", () => {
    render(<ProjectTab {...defaultProps} isActive={true} />);
    expect(screen.getByLabelText("Close MyProject")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked and stops propagation", () => {
    render(<ProjectTab {...defaultProps} isActive={true} />);
    const closeBtn = screen.getByLabelText("Close MyProject");
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    // onSelect should NOT have been called due to stopPropagation
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
  });

  it("shows folder icon when idle (no busy sessions)", () => {
    const { container } = render(<ProjectTab {...defaultProps} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
