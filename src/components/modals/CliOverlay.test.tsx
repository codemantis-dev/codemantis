import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import CliOverlay from "./CliOverlay";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";

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
});
