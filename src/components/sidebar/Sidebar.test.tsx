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
});
