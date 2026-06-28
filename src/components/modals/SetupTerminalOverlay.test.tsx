import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SetupTerminalOverlay from "./SetupTerminalOverlay";
import { useUiStore } from "../../stores/uiStore";
import { createTerminal, closeTerminal } from "../../lib/tauri-commands";

vi.mock("../../lib/tauri-commands", () => ({
  createTerminal: vi.fn().mockResolvedValue({ id: "t1", session_id: "onboarding-setup", name: "Sign in" }),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
  sendTerminalInput: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/test"),
}));
vi.mock("../rightpanel/TerminalView", () => ({
  default: () => <div data-testid="terminal-view" />,
}));
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Overlay: ({ className }: { className: string }) => <div className={className} />,
  Content: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content" {...props}>{children}</div>
  ),
  Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

describe("SetupTerminalOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      showSetupTerminal: false,
      setupTerminalAgent: null,
      claudeBinaryPath: "/usr/local/bin/claude",
      codexBinaryPath: "/usr/local/bin/codex",
    });
  });

  it("does not render when not shown", () => {
    const { container } = render(<SetupTerminalOverlay />);
    expect(container.querySelector("[data-testid='dialog-root']")).not.toBeInTheDocument();
  });

  it("spawns a session-less PTY with the Claude binary (no login argv)", async () => {
    useUiStore.setState({ showSetupTerminal: true, setupTerminalAgent: "claude_code" });
    render(<SetupTerminalOverlay />);
    expect(screen.getByText("Sign in to Claude Code")).toBeInTheDocument();
    await waitFor(() =>
      expect(createTerminal).toHaveBeenCalledWith(
        "onboarding-setup",
        "/Users/test",
        "/usr/local/bin/claude",
        "Sign in to Claude Code",
        undefined,
      )
    );
  });

  it("runs `codex login` as argv for Codex", async () => {
    useUiStore.setState({ showSetupTerminal: true, setupTerminalAgent: "codex" });
    render(<SetupTerminalOverlay />);
    await waitFor(() =>
      expect(createTerminal).toHaveBeenCalledWith(
        "onboarding-setup",
        "/Users/test",
        "/usr/local/bin/codex",
        "Sign in to OpenAI Codex",
        ["login"],
      )
    );
  });

  it("closes the terminal and fires onClosed when dismissed", async () => {
    const onClosed = vi.fn();
    useUiStore.setState({ showSetupTerminal: true, setupTerminalAgent: "claude_code" });
    render(<SetupTerminalOverlay onClosed={onClosed} />);
    await waitFor(() => expect(screen.getByTestId("terminal-view")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Close sign-in overlay"));

    await waitFor(() => expect(closeTerminal).toHaveBeenCalledWith("t1"));
    expect(onClosed).toHaveBeenCalled();
    // Visibility state is reset so the overlay can be reopened cleanly.
    expect(useUiStore.getState().showSetupTerminal).toBe(false);
  });
});
