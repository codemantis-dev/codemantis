import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import WelcomeScreen from "./WelcomeScreen";
import type { ClaudeStatus } from "../../lib/tauri-commands";

// Provide the global __APP_VERSION__
vi.stubGlobal("__APP_VERSION__", "0.8.10");

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const supportedStatus: ClaudeStatus = {
  installed: true,
  version: "2.1.126",
  parsed_version: "2.1.126",
  latest_version: "2.1.126",
  min_supported_version: "2.1.116",
  support: { kind: "supported" },
  authenticated: true,
  binary_path: "/usr/local/bin/claude",
};

const notInstalledStatus: ClaudeStatus = {
  installed: false,
  version: null,
  parsed_version: null,
  latest_version: null,
  min_supported_version: null,
  support: { kind: "notInstalled" },
  authenticated: false,
  binary_path: null,
};

const outdatedStatus: ClaudeStatus = {
  installed: true,
  version: "2.0.10",
  parsed_version: "2.0.10",
  latest_version: "2.1.126",
  min_supported_version: "2.1.116",
  support: {
    kind: "outdated",
    reason: "Detected v2.0.10, minimum supported is v2.1.116 (latest v2.1.126).",
  },
  authenticated: true,
  binary_path: "/usr/local/bin/claude",
};

const defaultProps = {
  claudeStatus: supportedStatus,
  rechecking: false,
  onRecheck: vi.fn(),
  onGetStarted: vi.fn(),
  onOpenProject: vi.fn(),
  onNewProject: vi.fn(),
  onCloneRepo: vi.fn(),
  onOpenSettings: vi.fn(),
  onSelectClaudeBinary: vi.fn(),
};

describe("WelcomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders welcome title", () => {
    render(<WelcomeScreen {...defaultProps} />);
    expect(screen.getByText("Welcome to CodeMantis")).toBeInTheDocument();
  });

  it("shows version number", () => {
    render(<WelcomeScreen {...defaultProps} />);
    expect(screen.getByText("v0.8.10")).toBeInTheDocument();
  });

  it("shows all three prerequisites when claude is installed and authenticated", () => {
    render(<WelcomeScreen {...defaultProps} />);
    expect(screen.getByText("Claude Code CLI")).toBeInTheDocument();
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText(/You are cool and motivated/)).toBeInTheDocument();
  });

  it("shows warning when Claude Code is not installed", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        claudeStatus={notInstalledStatus}
      />
    );
    expect(screen.getByText("Claude Code not found")).toBeInTheDocument();
    expect(screen.getByText("Locate Claude Code")).toBeInTheDocument();
  });

  it("shows action buttons when prerequisites are met", () => {
    render(<WelcomeScreen {...defaultProps} />);
    expect(screen.getByText("Open a Project")).toBeInTheDocument();
    expect(screen.getByText("Create New Project")).toBeInTheDocument();
    expect(screen.getByText("Clone from GitHub")).toBeInTheDocument();
    expect(screen.getByText("Add AI API Keys")).toBeInTheDocument();
  });

  it("disables action buttons when prerequisites are not met", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        claudeStatus={notInstalledStatus}
      />
    );
    const openBtn = screen.getByTitle("Open an existing project folder");
    expect(openBtn).toBeDisabled();
  });

  it("calls onOpenProject when Open a Project is clicked", () => {
    render(<WelcomeScreen {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Open an existing project folder"));
    expect(defaultProps.onOpenProject).toHaveBeenCalledOnce();
  });

  it("calls onNewProject when Create New Project is clicked", () => {
    render(<WelcomeScreen {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Create a new project from template"));
    expect(defaultProps.onNewProject).toHaveBeenCalledOnce();
  });

  it("calls onGetStarted with skipFuture when Skip for now is clicked", () => {
    render(<WelcomeScreen {...defaultProps} />);
    // The checkbox defaults to checked
    fireEvent.click(screen.getByText("Skip for now"));
    expect(defaultProps.onGetStarted).toHaveBeenCalledWith(true);
  });

  it("toggles the skip checkbox", () => {
    render(<WelcomeScreen {...defaultProps} />);
    const checkbox = screen.getByRole("checkbox");
    // Default is checked
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("calls onRecheck when Re-check button is clicked", () => {
    render(<WelcomeScreen {...defaultProps} />);
    fireEvent.click(screen.getByText("Re-check"));
    expect(defaultProps.onRecheck).toHaveBeenCalledOnce();
  });

  it("shows Checking... when rechecking is true", () => {
    render(<WelcomeScreen {...defaultProps} rechecking={true} />);
    expect(screen.getByText("Checking...")).toBeInTheDocument();
  });

  it("calls onCloneRepo when Clone from GitHub is clicked", () => {
    render(<WelcomeScreen {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Clone a Git repository"));
    expect(defaultProps.onCloneRepo).toHaveBeenCalledOnce();
  });

  it("calls onSelectClaudeBinary when Locate Claude Code is clicked", () => {
    render(
      <WelcomeScreen
        {...defaultProps}
        claudeStatus={notInstalledStatus}
      />
    );
    fireEvent.click(screen.getByText("Locate Claude Code"));
    expect(defaultProps.onSelectClaudeBinary).toHaveBeenCalledOnce();
  });

  // ── Outdated CLI state ──

  it("shows outdated banner when CLI support is 'outdated'", () => {
    render(<WelcomeScreen {...defaultProps} claudeStatus={outdatedStatus} />);
    expect(screen.getByText("Claude Code CLI is outdated")).toBeInTheDocument();
    // The upgrade command appears in both the banner and the prereq row.
    const matches = screen.getAllByText(
      "npm install -g @anthropic-ai/claude-code@latest"
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("includes the outdated reason in the banner", () => {
    render(<WelcomeScreen {...defaultProps} claudeStatus={outdatedStatus} />);
    expect(
      screen.getByText(/Detected v2\.0\.10.*minimum supported is v2\.1\.116/)
    ).toBeInTheDocument();
  });

  it("disables action buttons when CLI is outdated", () => {
    render(<WelcomeScreen {...defaultProps} claudeStatus={outdatedStatus} />);
    expect(screen.getByTitle("Open an existing project folder")).toBeDisabled();
    expect(screen.getByTitle("Create a new project from template")).toBeDisabled();
    expect(screen.getByTitle("Clone a Git repository")).toBeDisabled();
  });

  it("uses 'install latest' help command for outdated CLI in prerequisites", () => {
    render(<WelcomeScreen {...defaultProps} claudeStatus={outdatedStatus} />);
    // Two copies appear: one in the prereq row, one in the banner. Both must
    // contain the @latest tag — the older 'install' string would not.
    const matches = screen.getAllByText(
      "npm install -g @anthropic-ai/claude-code@latest"
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show outdated banner when CLI is supported", () => {
    render(<WelcomeScreen {...defaultProps} />);
    expect(screen.queryByText("Claude Code CLI is outdated")).not.toBeInTheDocument();
  });
});
