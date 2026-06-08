import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CliOverlay from "./CliOverlay";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { pauseSessionProcess, createTerminal } from "../../lib/tauri-commands";

vi.mock("../../lib/tauri-commands", () => ({
  createTerminal: vi.fn().mockRejectedValue(new Error("mock")),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
  sendTerminalInput: vi.fn().mockResolvedValue(undefined),
  pauseSessionProcess: vi.fn().mockRejectedValue(new Error("mock")),
  resumeSessionProcess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
vi.mock("../rightpanel/TerminalView", () => ({
  default: () => <div data-testid="terminal-view" />,
}));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div data-testid="dialog-overlay" className={className} />,
  Content: ({ children, ...props }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <div data-testid="dialog-content" {...props}>{children}</div>
  ),
  Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h2 className={className}>{children}</h2>
  ),
  Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <p className={className}>{children}</p>
  ),
}));

describe("CliOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showCliOverlay: false,
      claudeBinaryPath: "/usr/local/bin/claude",
      cliOverlaySessionId: null,
      cliOverlayProjectPath: null,
      cliOverlayInitialInput: null,
    });
    useSessionStore.setState({
      activeSessionId: null,
      sessions: new Map(),
    });
  });

  it("does not render dialog when overlay is not shown", () => {
    const { container } = render(<CliOverlay />);
    expect(container.querySelector("[data-testid='dialog-root']")).not.toBeInTheDocument();
  });

  it("renders dialog with title when overlay is shown", () => {
    useUiStore.setState({ showCliOverlay: true });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", project_path: "/project", cli_session_id: "cli-1" } as never]]),
    });
    render(<CliOverlay />);
    expect(screen.getByText("Claude CLI")).toBeInTheDocument();
  });

  it("shows loading state initially when opening", () => {
    useUiStore.setState({ showCliOverlay: true });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", project_path: "/project", cli_session_id: "cli-1" } as never]]),
    });
    render(<CliOverlay />);
    expect(screen.getByText("Pausing session and starting Claude CLI...")).toBeInTheDocument();
  });

  it("renders close button with proper aria label", () => {
    useUiStore.setState({ showCliOverlay: true });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", project_path: "/project", cli_session_id: "cli-1" } as never]]),
    });
    render(<CliOverlay />);
    expect(screen.getByLabelText("Close CLI overlay")).toBeInTheDocument();
  });

  // Regression guard for the core Codex bug: opening the overlay must NOT
  // pause (kill) the Codex app-server — that's what made closing the
  // overlay call thread/resume → "no rollout found" → dead session.
  it("does NOT pause the process for a Codex session", async () => {
    useUiStore.setState({ showCliOverlay: true, codexBinaryPath: "/usr/local/bin/codex" });
    useSessionStore.setState({
      activeSessionId: "c1",
      sessions: new Map([["c1", { id: "c1", project_path: "/project", agent_id: "codex" } as never]]),
    });
    render(<CliOverlay />);
    // The Codex path skips pause and goes straight to spawning the PTY.
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
    expect(pauseSessionProcess).not.toHaveBeenCalled();
    expect(screen.getByText("Codex CLI")).toBeInTheDocument();
  });

  it("DOES pause the process for a Claude session", async () => {
    useUiStore.setState({ showCliOverlay: true, claudeBinaryPath: "/usr/local/bin/claude" });
    useSessionStore.setState({
      activeSessionId: "s1",
      sessions: new Map([["s1", { id: "s1", project_path: "/project", agent_id: "claude_code", cli_session_id: "cli-1" } as never]]),
    });
    render(<CliOverlay />);
    await waitFor(() => expect(pauseSessionProcess).toHaveBeenCalledWith("s1"));
  });
});
