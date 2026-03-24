import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionSubTabs from "./SessionSubTabs";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/tauri-commands", () => ({}));
vi.mock("../shared/StatusDot", () => ({
  default: () => <span data-testid="status-dot" />,
}));

describe("SessionSubTabs", () => {
  const defaultProps = {
    onAddSession: vi.fn(),
    onCloseSession: vi.fn(),
    onRenameSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showProjectLog: false,
      showClaudeHistory: false,
    });
  });

  it("returns null when no active project path", () => {
    useSessionStore.setState({
      activeProjectPath: null,
      sessions: new Map(),
      tabOrder: [],
      activeSessionId: null,
      sessionStreaming: new Map(),
    });
    const { container } = render(<SessionSubTabs {...defaultProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders session tabs for the active project", () => {
    const sessions = new Map([
      ["s1", { id: "s1", name: "Session 1", project_path: "/project", model: "claude-sonnet-4-6" } as never],
      ["s2", { id: "s2", name: "Session 2", project_path: "/project", model: null } as never],
    ]);
    useSessionStore.setState({
      activeProjectPath: "/project",
      sessions,
      tabOrder: ["s1", "s2"],
      activeSessionId: "s1",
      sessionStreaming: new Map(),
      setActiveSessionInProject: vi.fn(),
    });
    render(<SessionSubTabs {...defaultProps} />);
    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("Session 2")).toBeInTheDocument();
  });

  it("calls onAddSession when + button is clicked", () => {
    useSessionStore.setState({
      activeProjectPath: "/project",
      sessions: new Map(),
      tabOrder: [],
      activeSessionId: null,
      sessionStreaming: new Map(),
    });
    render(<SessionSubTabs {...defaultProps} />);
    fireEvent.click(screen.getByTitle("New session in this project"));
    expect(defaultProps.onAddSession).toHaveBeenCalledTimes(1);
  });

  it("renders Project Log and History buttons", () => {
    useSessionStore.setState({
      activeProjectPath: "/project",
      sessions: new Map(),
      tabOrder: [],
      activeSessionId: null,
      sessionStreaming: new Map(),
    });
    render(<SessionSubTabs {...defaultProps} />);
    expect(screen.getByText("Project Log")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("activates History tab when clicked", () => {
    const setShowClaudeHistory = vi.fn();
    useUiStore.setState({ setShowClaudeHistory });
    useSessionStore.setState({
      activeProjectPath: "/project",
      sessions: new Map(),
      tabOrder: [],
      activeSessionId: null,
      sessionStreaming: new Map(),
    });
    render(<SessionSubTabs {...defaultProps} />);
    fireEvent.click(screen.getByText("History"));
    expect(setShowClaudeHistory).toHaveBeenCalledWith(true);
  });
});
