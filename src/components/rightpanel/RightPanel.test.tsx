import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RightPanel from "./RightPanel";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";

// Mock all child components
vi.mock("./ActivityFeed", () => ({
  default: () => <div data-testid="activity-feed" />,
}));
vi.mock("./ActivityDetailPanel", () => ({
  default: () => <div data-testid="activity-detail" />,
}));
vi.mock("./TerminalView", () => ({
  default: ({ terminalId, isVisible }: { terminalId: string; isVisible: boolean }) => (
    <div data-testid={`terminal-${terminalId}`} data-visible={isVisible} />
  ),
}));
vi.mock("./TerminalTabs", () => ({
  default: () => <div data-testid="terminal-tabs" />,
}));
vi.mock("./QuickCommands", () => ({
  default: () => <div data-testid="quick-commands" />,
}));
vi.mock("./FileViewer", () => ({
  default: () => <div data-testid="file-viewer" />,
}));
vi.mock("./ChangelogFeed", () => ({
  default: () => <div data-testid="changelog-feed" />,
}));
vi.mock("./AssistantPanel", () => ({
  default: () => <div data-testid="assistant-panel" />,
}));
vi.mock("./DevServerBanner", () => ({
  default: () => <div data-testid="dev-server-banner" />,
}));
vi.mock("../../hooks/useTerminal", () => ({
  useTerminal: () => ({
    createTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  }),
}));

describe("RightPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ rightTab: "activity", sessionRightTab: new Map() });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map(),
    });
    useTerminalStore.setState({
      sessionTerminals: new Map(),
      activeTerminalId: new Map(),
    });
  });

  it("renders all five tab buttons", () => {
    render(<RightPanel />);
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Changelog")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("switches to terminal tab on click", () => {
    render(<RightPanel />);
    fireEvent.click(screen.getByText("Terminal"));
    expect(useUiStore.getState().rightTab).toBe("terminal");
  });

  it("shows activity feed as default panel", () => {
    render(<RightPanel />);
    const activityFeed = screen.getByTestId("activity-feed");
    expect(activityFeed.parentElement!.style.display).toBe("block");
  });

  it("shows 'No terminals' when terminal tab active with no terminals", () => {
    useUiStore.setState({ rightTab: "terminal" });
    render(<RightPanel />);
    expect(screen.getByText("No terminals")).toBeInTheDocument();
    expect(screen.getByText("Create Terminal")).toBeInTheDocument();
  });

  it("renders terminal tabs when terminals exist", () => {
    useUiStore.setState({ rightTab: "terminal" });
    useTerminalStore.setState({
      sessionTerminals: new Map([
        ["s1", [{ id: "t1", sessionId: "s1", name: "bash", sortOrder: 0, createdAt: "", isRunning: true }]],
      ]),
      activeTerminalId: new Map([["s1", "t1"]]),
    });
    render(<RightPanel />);
    expect(screen.getByTestId("terminal-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("quick-commands")).toBeInTheDocument();
  });

  describe("per-session right tab restoration", () => {
    it("restores saved right tab when switching sessions", () => {
      useUiStore.setState({
        rightTab: "activity",
        sessionRightTab: new Map([["s2", "assistant"]]),
      });
      useSessionStore.setState({ activeSessionId: "s1" });
      const { rerender } = render(<RightPanel />);

      // Switch to s2 which had "assistant" saved
      act(() => useSessionStore.setState({ activeSessionId: "s2" }));
      rerender(<RightPanel />);

      expect(useUiStore.getState().rightTab).toBe("assistant");
    });

    it("saves outgoing session tab when switching away", () => {
      useUiStore.setState({ rightTab: "terminal", sessionRightTab: new Map() });
      useSessionStore.setState({ activeSessionId: "s1" });
      const { rerender } = render(<RightPanel />);

      // Switch to s2
      act(() => useSessionStore.setState({ activeSessionId: "s2" }));
      rerender(<RightPanel />);

      // s1 should have been saved as "terminal"
      expect(useUiStore.getState().sessionRightTab.get("s1")).toBe("terminal");
    });

    it("keeps current tab when switching to a session with no saved tab", () => {
      useUiStore.setState({ rightTab: "files", sessionRightTab: new Map() });
      useSessionStore.setState({ activeSessionId: "s1" });
      const { rerender } = render(<RightPanel />);

      // Switch to s2 which has no saved tab
      act(() => useSessionStore.setState({ activeSessionId: "s2" }));
      rerender(<RightPanel />);

      expect(useUiStore.getState().rightTab).toBe("files");
    });

    it("round-trips tab state across multiple session switches", () => {
      useSessionStore.setState({ activeSessionId: "s1" });
      useUiStore.setState({ rightTab: "activity", sessionRightTab: new Map() });
      const { rerender } = render(<RightPanel />);

      // In s1, switch to terminal
      fireEvent.click(screen.getByText("Terminal"));
      expect(useUiStore.getState().rightTab).toBe("terminal");

      // Switch to s2
      act(() => useSessionStore.setState({ activeSessionId: "s2" }));
      rerender(<RightPanel />);

      // In s2, switch to assistant
      fireEvent.click(screen.getByText("Assistant"));
      expect(useUiStore.getState().rightTab).toBe("assistant");

      // Switch back to s1 — should restore "terminal"
      act(() => useSessionStore.setState({ activeSessionId: "s1" }));
      rerender(<RightPanel />);
      expect(useUiStore.getState().rightTab).toBe("terminal");

      // Switch back to s2 — should restore "assistant"
      act(() => useSessionStore.setState({ activeSessionId: "s2" }));
      rerender(<RightPanel />);
      expect(useUiStore.getState().rightTab).toBe("assistant");
    });
  });
});
