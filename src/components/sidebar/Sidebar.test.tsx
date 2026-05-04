import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

vi.mock("../../lib/tauri-commands", () => ({}));
vi.mock("../../lib/model-context", () => ({
  getContextWindowForModel: () => 200000,
}));
vi.mock("../../hooks/useFileTree", () => ({
  useFileTree: vi.fn(() => ({
    files: [],
    loading: false,
    refresh: vi.fn(),
  })),
}));
vi.mock("../../hooks/useGitStatus", () => ({
  useGitStatus: vi.fn(() => ({
    gitStatus: null,
    refresh: vi.fn(),
  })),
}));
vi.mock("./FileTree", () => ({
  default: vi.fn(() => <div data-testid="file-tree" />),
}));
vi.mock("./GitStatusCard", () => ({
  default: vi.fn(() => null),
}));
vi.mock("../shared/ContextMeter", () => ({
  default: vi.fn(() => <div data-testid="context-meter" />),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ fileTreeRefreshTrigger: 0 });
  });

  it("shows 'No project open' when no session is active", () => {
    useSessionStore.setState({
      activeSessionId: null,
      sessions: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
    });
    render(<Sidebar />);
    expect(screen.getByText("No project open")).toBeInTheDocument();
  });

  it("renders the Files header", () => {
    useSessionStore.setState({
      activeSessionId: null,
      sessions: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
    });
    render(<Sidebar />);
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("renders ContextMeter", () => {
    useSessionStore.setState({
      activeSessionId: null,
      sessions: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
    });
    render(<Sidebar />);
    expect(screen.getByTestId("context-meter")).toBeInTheDocument();
  });

  it("shows loading state when session is active and loading", async () => {
    const { useFileTree } = await import("../../hooks/useFileTree");
    (useFileTree as ReturnType<typeof vi.fn>).mockReturnValue({
      files: [],
      loading: true,
      refresh: vi.fn(),
    });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", project_path: "/project", name: "Test" } as never]]),
      sessionContext: new Map(),
      sessionStats: new Map(),
    });
    render(<Sidebar />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // Regression: opening another project via the "Open Project" dialogue while
  // the previous project's session is still cached produced a transient render
  // where `activeSessionId === null` but `useGitStatus` still returned the
  // previous repo's `is_git_repo: true`. The Git Status block dereferenced
  // `session!.project_path` and crashed with
  // "null is not an object (evaluating 'e.project_path')".
  it("does not crash when session is null but gitStatus is stale (project-switch race)", async () => {
    const { useGitStatus } = await import("../../hooks/useGitStatus");
    (useGitStatus as ReturnType<typeof vi.fn>).mockReturnValue({
      gitStatus: {
        is_git_repo: true,
        branch: "main",
        uncommitted_changes: 0,
        untracked_files: 0,
        staged_files: 0,
        ahead: 0,
        behind: 0,
      },
      refresh: vi.fn(),
    });
    useSessionStore.setState({
      activeSessionId: null,
      sessions: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
    });
    expect(() => render(<Sidebar />)).not.toThrow();
    expect(screen.getByText("No project open")).toBeInTheDocument();
  });
});
