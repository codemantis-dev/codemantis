/**
 * Integration test: Welcome-screen CLI install/update + sign-in wiring.
 *
 * Exercises the REAL cross-module path for the non-developer onboarding fix:
 *   WelcomeScreen → CliSetupButton → tauri-commands → invoke/listen boundary,
 * and WelcomeScreen → onSignIn → real uiStore → setup-terminal overlay state.
 * Only the Tauri IPC boundary (invoke/listen) is mocked; the components, the
 * command layer, and the Zustand store are all real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import WelcomeScreen from "../../components/onboarding/WelcomeScreen";
import { useUiStore } from "../../stores/uiStore";
import type { ClaudeStatus, CliSetupProgress } from "../../lib/tauri-commands";

vi.stubGlobal("__APP_VERSION__", "9.9.9");
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const outdatedAuthed: ClaudeStatus = {
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

const installedUnauthed: ClaudeStatus = {
  ...outdatedAuthed,
  version: "2.1.126",
  parsed_version: "2.1.126",
  support: { kind: "supported" },
  authenticated: false,
};

function baseProps() {
  return {
    rechecking: false,
    onRecheck: vi.fn(),
    onSignIn: vi.fn(),
    onGetStarted: vi.fn(),
    onOpenProject: vi.fn(),
    onNewProject: vi.fn(),
    onCloneRepo: vi.fn(),
    onOpenSettings: vi.fn(),
    onSelectClaudeBinary: vi.fn(),
  };
}

describe("CLI setup onboarding pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ showSetupTerminal: false, setupTerminalAgent: null });
    mockListen.mockResolvedValue(() => {});
    mockInvoke.mockResolvedValue(undefined);
  });

  it("runs the install command, streams progress, and re-checks on success", async () => {
    let progressCb:
      | ((e: { payload: CliSetupProgress }) => void)
      | null = null;
    mockListen.mockImplementation((event: string, cb: unknown) => {
      if (event === "cli-setup:progress") {
        progressCb = cb as (e: { payload: CliSetupProgress }) => void;
      }
      return Promise.resolve(() => {});
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "install_or_update_cli") {
        // The backend would stream stdout lines as it installs.
        progressCb?.({
          payload: { agent: "claude_code", line: "Downloading…", stream: "stdout" },
        });
        return Promise.resolve({
          success: true,
          exitCode: 0,
          message: "Claude Code installed successfully. Re-checking…",
        });
      }
      return Promise.resolve(undefined);
    });

    const props = baseProps();
    render(<WelcomeScreen {...props} claudeStatus={outdatedAuthed} />);

    fireEvent.click(screen.getByRole("button", { name: /Update Claude Code/ }));

    // The full chain fired: progress subscription, the install invoke, and the
    // onDone → re-check callback.
    await waitFor(() => expect(props.onRecheck).toHaveBeenCalled());
    expect(mockListen).toHaveBeenCalledWith(
      "cli-setup:progress",
      expect.any(Function),
    );
    expect(mockInvoke).toHaveBeenCalledWith("install_or_update_cli", {
      agent: "claude_code",
      channel: undefined,
    });
  });

  it("opens the session-less sign-in overlay via the real uiStore", () => {
    // Wire the Sign-in button to the real store, exactly like App.tsx does.
    const props = {
      ...baseProps(),
      onSignIn: (agent: "claude_code" | "codex") =>
        useUiStore.getState().openSetupTerminal(agent),
    };

    render(<WelcomeScreen {...props} claudeStatus={installedUnauthed} />);

    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/ }));

    expect(useUiStore.getState().showSetupTerminal).toBe(true);
    expect(useUiStore.getState().setupTerminalAgent).toBe("claude_code");
  });
});
