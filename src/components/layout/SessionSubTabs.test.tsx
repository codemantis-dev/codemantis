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
      // Default to a single installed agent so the "+" stays a one-click
      // control; the agent-picker tests opt into both-installed explicitly.
      agentInstall: { claude_code: true, codex: false },
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

  it("calls onAddSession directly when only one agent is installed", () => {
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
    // No agent override — the resolver picks the lone installed agent.
    expect(defaultProps.onAddSession).toHaveBeenCalledWith();
  });

  describe("agent picker (both agents installed)", () => {
    beforeEach(() => {
      useUiStore.setState({
        agentInstall: { claude_code: true, codex: true },
        setSelectedAgentId: vi.fn(),
      });
      useSessionStore.setState({
        activeProjectPath: "/project",
        sessions: new Map(),
        tabOrder: [],
        activeSessionId: null,
        sessionStreaming: new Map(),
      });
    });

    it("opens an agent menu instead of creating a session immediately", () => {
      render(<SessionSubTabs {...defaultProps} />);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTitle("New session — choose agent"));
      expect(defaultProps.onAddSession).not.toHaveBeenCalled();
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
      expect(screen.getByText("OpenAI Codex")).toBeInTheDocument();
    });

    // Regression: the menu used to be an `absolute` child of the tab strip,
    // which is an `overflow-x-auto overflow-y-hidden` scroll container — so
    // the dropdown rendered into the DOM but was clipped to invisibility and
    // clicking "+" appeared to do nothing. It must be portaled to <body> with
    // `position: fixed` to escape that clip. jsdom can't assert visual
    // clipping, so we assert the structural guarantee: the menu is NOT nested
    // inside the overflow-hidden strip.
    it("portals the menu out of the overflow-clipped tab strip", () => {
      render(<SessionSubTabs {...defaultProps} />);
      fireEvent.click(screen.getByTitle("New session — choose agent"));
      const menu = screen.getByRole("menu");
      // Portaled directly under <body>, not inside the clipping strip.
      expect(menu.closest(".overflow-y-hidden")).toBeNull();
      expect(menu).toHaveClass("fixed");
      expect(menu.parentElement).toBe(document.body);
    });

    it("creates a session with the chosen agent and persists the choice", () => {
      const setSelectedAgentId = vi.fn();
      useUiStore.setState({ setSelectedAgentId });
      render(<SessionSubTabs {...defaultProps} />);
      fireEvent.click(screen.getByTitle("New session — choose agent"));
      fireEvent.click(screen.getByText("OpenAI Codex"));
      expect(defaultProps.onAddSession).toHaveBeenCalledWith("codex");
      expect(setSelectedAgentId).toHaveBeenCalledWith("codex");
      // Menu closes after a pick.
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
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
    expect(screen.getByText("Session History")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText("Session History"));
    expect(setShowClaudeHistory).toHaveBeenCalledWith(true);
  });
});
