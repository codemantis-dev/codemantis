import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectTab from "./ProjectTab";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import type { Session } from "../../types/session";

vi.mock("../../lib/tauri-commands", () => ({}));

function session(id: string, projectPath: string): Session {
  return {
    id,
    name: id,
    project_path: projectPath,
    status: "connected",
    created_at: "",
    model: null,
    icon_index: 0,
  };
}

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
      sessionStuck: new Map(),
    });
    useActivityStore.setState({ approvalQueue: [] });
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

  it("shows the active-session count instead of the total when working", () => {
    useSessionStore.setState({
      tabOrder: ["a", "b"],
      sessions: new Map([
        ["a", session("a", "/path/to/project")],
        ["b", session("b", "/path/to/project")],
      ]),
      sessionBusy: new Map([["a", true]]), // only one of two sessions working
      lastEventTimestamp: new Map([["a", Date.now()]]),
      sessionStuck: new Map(),
    });
    const { container } = render(<ProjectTab {...defaultProps} sessionCount={2} />);
    // Active count "1" is shown; the total "2" is not.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
    // Folder icon is replaced by the status dot.
    expect(container.querySelector(".bg-green-400")).toBeInTheDocument();
  });

  it("tints the indicator yellow when a session is stuck", () => {
    useSessionStore.setState({
      tabOrder: ["a"],
      sessions: new Map([["a", session("a", "/path/to/project")]]),
      sessionBusy: new Map([["a", true]]),
      lastEventTimestamp: new Map([["a", Date.now()]]),
      sessionStuck: new Map([["a", { since: Date.now(), reason: "no-progress" }]]),
    });
    const { container } = render(<ProjectTab {...defaultProps} sessionCount={1} />);
    expect(container.querySelector(".bg-yellow-400")).toBeInTheDocument();
    expect(container.querySelector(".bg-green-400")).not.toBeInTheDocument();
  });

  it("tints the indicator yellow when a session awaits approval", () => {
    useSessionStore.setState({
      tabOrder: ["a"],
      sessions: new Map([["a", session("a", "/path/to/project")]]),
      sessionBusy: new Map([["a", true]]),
      lastEventTimestamp: new Map([["a", Date.now()]]),
      sessionStuck: new Map(),
    });
    useActivityStore.setState({
      approvalQueue: [
        {
          requestId: "r1",
          toolUseId: "t1",
          toolName: "Bash",
          toolInput: {},
          sessionId: "a",
          timestamp: "",
        },
      ],
    });
    const { container } = render(<ProjectTab {...defaultProps} sessionCount={1} />);
    expect(container.querySelector(".bg-yellow-400")).toBeInTheDocument();
  });
});
