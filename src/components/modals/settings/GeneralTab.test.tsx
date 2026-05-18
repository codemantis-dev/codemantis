import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GeneralTab from "./GeneralTab";

// @ts-expect-error Vite global define
globalThis.__APP_VERSION__ = "0.8.10";

const isLegacyClaudePathActiveMock = vi.fn(() => Promise.resolve(false));
vi.mock("../../../lib/tauri-commands", () => ({
  updateSettings: vi.fn(() => Promise.resolve()),
  getSettings: vi.fn(() => Promise.resolve({})),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  isLegacyClaudePathActive: () => isLegacyClaudePathActiveMock(),
}));

vi.mock("../../../types/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../types/settings")>()),
  THEMES: [
    { id: "midnight", label: "Midnight", isDark: true },
    { id: "ocean", label: "Ocean", isDark: true },
    { id: "dawn", label: "Dawn", isDark: false },
  ],
}));

describe("GeneralTab", () => {
  const defaultProps = {
    theme: "midnight" as const,
    fontSize: 13,
    sendShortcut: "cmd+enter",
    triviaEnabled: true,
    autoOpenFiles: true,
    defaultContextWindow: 200000,
    showWelcomeScreen: false,
    onThemeChange: vi.fn(),
    onFontSizeChange: vi.fn(),
    onSendShortcutChange: vi.fn(),
    onTriviaEnabledChange: vi.fn(),
    onAutoOpenFilesChange: vi.fn(),
    onDefaultContextWindowChange: vi.fn(),
    onShowWelcomeScreenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isLegacyClaudePathActiveMock.mockResolvedValue(false);
  });

  it("renders the title", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("hides the legacy CLAUDE path notice when the env var is unset", async () => {
    isLegacyClaudePathActiveMock.mockResolvedValue(false);
    render(<GeneralTab {...defaultProps} />);
    // Allow the useEffect microtask to resolve.
    await Promise.resolve();
    expect(
      screen.queryByTestId("legacy-claude-path-notice"),
    ).not.toBeInTheDocument();
  });

  it("shows the legacy CLAUDE path notice when forced", async () => {
    isLegacyClaudePathActiveMock.mockResolvedValue(true);
    render(<GeneralTab {...defaultProps} />);
    expect(
      await screen.findByTestId("legacy-claude-path-notice"),
    ).toBeInTheDocument();
    expect(screen.getByText("Legacy CLAUDE path active")).toBeInTheDocument();
  });

  it("renders theme options", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Midnight")).toBeInTheDocument();
    expect(screen.getByText("Ocean")).toBeInTheDocument();
    expect(screen.getByText("Dawn")).toBeInTheDocument();
  });

  it("calls onThemeChange when a theme is clicked", () => {
    render(<GeneralTab {...defaultProps} />);
    fireEvent.click(screen.getByText("Ocean"));
    expect(defaultProps.onThemeChange).toHaveBeenCalledWith("ocean");
  });

  it("renders font size input", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Font Size")).toBeInTheDocument();
    expect(screen.getByDisplayValue("13")).toBeInTheDocument();
  });

  it("calls onFontSizeChange when font size changes", () => {
    render(<GeneralTab {...defaultProps} />);
    const fontInput = screen.getByDisplayValue("13");
    fireEvent.change(fontInput, { target: { value: "15" } });
    expect(defaultProps.onFontSizeChange).toHaveBeenCalledWith(15);
  });

  it("renders send shortcut select", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Send Shortcut")).toBeInTheDocument();
  });

  it("renders trivia toggle", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Show trivia while waiting")).toBeInTheDocument();
  });

  it("renders auto-open files toggle", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Auto-open edited files")).toBeInTheDocument();
  });

  it("renders context window buttons", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("200K")).toBeInTheDocument();
    expect(screen.getByText("1M")).toBeInTheDocument();
  });

  it("calls onDefaultContextWindowChange when context window button is clicked", () => {
    render(<GeneralTab {...defaultProps} />);
    fireEvent.click(screen.getByText("1M"));
    expect(defaultProps.onDefaultContextWindowChange).toHaveBeenCalledWith(1000000);
  });

  it("renders welcome screen toggle", () => {
    render(<GeneralTab {...defaultProps} />);
    expect(screen.getByText("Show welcome screen on launch")).toBeInTheDocument();
  });
});
