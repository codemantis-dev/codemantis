import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import ScaffoldProgress from "./ScaffoldProgress";
import type { TemplateEntry, ScaffoldProgressEvent } from "../../types/project-templates";
import type { FrontendEvent } from "../../types/claude-events";

// ── Hoisted mocks ──

const {
  mockListenScaffoldProgress,
  mockCreateSession,
  mockSendMessage,
  mockInterruptSession,
  mockCloseSession,
  mockSetSessionMode,
  mockInitializeSession,
  mockListenChatEvents,
} = vi.hoisted(() => ({
  mockListenScaffoldProgress: vi.fn(() => Promise.resolve(() => {})),
  mockCreateSession: vi.fn(() => Promise.resolve({ id: "setup-1", name: "setup" })),
  mockSendMessage: vi.fn(() => Promise.resolve()),
  mockInterruptSession: vi.fn(() => Promise.resolve()),
  mockCloseSession: vi.fn(() => Promise.resolve()),
  mockSetSessionMode: vi.fn(() => Promise.resolve()),
  mockInitializeSession: vi.fn(() => Promise.resolve()),
  mockListenChatEvents: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("../../lib/tauri-commands", () => ({
  listenScaffoldProgress: mockListenScaffoldProgress,
  createSession: mockCreateSession,
  sendMessage: mockSendMessage,
  interruptSession: mockInterruptSession,
  closeSession: mockCloseSession,
  setSessionMode: mockSetSessionMode,
  initializeSession: mockInitializeSession,
  listenChatEvents: mockListenChatEvents,
}));

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ── Test fixtures ──

const TEMPLATE: TemplateEntry = {
  id: "nextjs-boilerplate",
  name: "Next.js Full-Stack",
  description: "Test",
  category: "full-stack",
  tags: ["next.js"],
  repo_url: "https://github.com/example/nextjs",
  branch: "main",
  license: "MIT",
  install_command: "npm install",
  dev_command: "npm run dev",
  icon: "triangle",
  verified: true,
  last_verified: "2026-03-10",
  scaffold_type: "git-clone",
};

const TEMPLATE_WITH_CHECKS: TemplateEntry = {
  ...TEMPLATE,
  id: "fumadocs-starter",
  name: "Fumadocs",
  install_command: "pnpm install",
  prerequisite_checks: [
    { command: "pnpm", label: "pnpm package manager", required: true, install_command: "npm install -g pnpm" },
  ],
};

const CLI_TEMPLATE: TemplateEntry = {
  ...TEMPLATE,
  id: "astro-starter",
  scaffold_type: "cli",
  cli_command: "pnpm create astro",
};

// ── Helpers ──

/** Capture the scaffold progress callback and return a function to emit events */
function captureProgressEmitter(): (event: ScaffoldProgressEvent) => void {
  let handler: ((event: ScaffoldProgressEvent) => void) | undefined;
  mockListenScaffoldProgress.mockImplementationOnce((cb: (event: ScaffoldProgressEvent) => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  });
  return (event: ScaffoldProgressEvent) => {
    if (!handler) throw new Error("Progress handler not captured — did you render after calling captureProgressEmitter?");
    handler(event);
  };
}

/** Capture the listenChatEvents callback and return a function to emit chat events */
function captureChatEmitter(): (event: FrontendEvent) => void {
  let handler: ((event: FrontendEvent) => void) | undefined;
  mockListenChatEvents.mockImplementationOnce((_sessionId: string, cb: (event: FrontendEvent) => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  });
  return (event: FrontendEvent) => {
    if (!handler) throw new Error("Chat handler not captured — did you call handleFixWithClaude first?");
    handler(event);
  };
}

// ── Tests ──

describe("ScaffoldProgress", () => {
  const defaultProps = {
    template: TEMPLATE,
    projectName: "my-project",
    projectPath: "/tmp",
    resultPath: null,
    warnings: [] as string[],
    scaffoldError: null as string | null,
    onOpenProject: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Existing behavior ──

  it("renders project name in header", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Setting up: my-project")).toBeInTheDocument();
  });

  it("shows git-clone steps for git-clone templates", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Validating environment")).toBeInTheDocument();
    expect(screen.getByText("Cloning template")).toBeInTheDocument();
    expect(screen.getByText("Cleaning up")).toBeInTheDocument();
    expect(screen.getByText("Installing dependencies")).toBeInTheDocument();
    expect(screen.getByText("Verifying project")).toBeInTheDocument();
    expect(screen.getByText("Setting up CLAUDE.md")).toBeInTheDocument();
    expect(screen.getByText("Finalizing project")).toBeInTheDocument();
  });

  it("shows CLI steps for CLI-generated templates", () => {
    render(<ScaffoldProgress {...defaultProps} template={CLI_TEMPLATE} />);
    expect(screen.getByText("Generating project")).toBeInTheDocument();
    expect(screen.getByText("Installing dependencies")).toBeInTheDocument();
    expect(screen.getByText("Running post-setup")).toBeInTheDocument();
    expect(screen.getByText("Verifying project")).toBeInTheDocument();
  });

  it("CLI steps have install before configure", () => {
    const { container } = render(<ScaffoldProgress {...defaultProps} template={CLI_TEMPLATE} />);
    const stepTexts = Array.from(container.querySelectorAll(".text-ui")).map((el) => el.textContent);
    const installIdx = stepTexts.indexOf("Installing dependencies");
    const configureIdx = stepTexts.indexOf("Running post-setup");
    expect(installIdx).toBeLessThan(configureIdx);
  });

  it("shows cancel button while in progress", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<ScaffoldProgress {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows Open in CodeMantis when result is available", () => {
    render(<ScaffoldProgress {...defaultProps} resultPath="/tmp/my-project" />);
    expect(screen.getByText("Project ready!")).toBeInTheDocument();
    expect(screen.getByText("Open in CodeMantis")).toBeInTheDocument();
  });

  it("calls onOpenProject when Open button is clicked", () => {
    const onOpen = vi.fn();
    render(<ScaffoldProgress {...defaultProps} resultPath="/tmp/my-project" onOpenProject={onOpen} />);
    fireEvent.click(screen.getByText("Open in CodeMantis"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("shows error message and retry button on scaffold error", () => {
    render(
      <ScaffoldProgress
        {...defaultProps}
        scaffoldError="Network error: could not clone"
      />
    );
    expect(screen.getByText("Network error: could not clone")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(
      <ScaffoldProgress
        {...defaultProps}
        scaffoldError="Something failed"
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows 'ready with warnings' when finished with warnings", () => {
    render(
      <ScaffoldProgress
        {...defaultProps}
        resultPath="/tmp/my-project"
        warnings={["Dependencies not installed — run 'npm install' manually"]}
      />
    );
    expect(screen.getByText("Project ready (with warnings)")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("Dependencies not installed — run 'npm install' manually")).toBeInTheDocument();
    expect(screen.getByText("Open in CodeMantis")).toBeInTheDocument();
  });

  it("shows multiple warnings", () => {
    render(
      <ScaffoldProgress
        {...defaultProps}
        resultPath="/tmp/my-project"
        warnings={[
          "Install failed: 'npm install' failed (exit code 1)",
          "node_modules appears empty — run 'npm install' manually",
        ]}
      />
    );
    expect(screen.getByText("2 warnings")).toBeInTheDocument();
  });

  it("shows 'Project ready!' with no warnings when clean finish", () => {
    render(
      <ScaffoldProgress
        {...defaultProps}
        resultPath="/tmp/my-project"
        warnings={[]}
      />
    );
    expect(screen.getByText("Project ready!")).toBeInTheDocument();
    expect(screen.getByText("Your project has been scaffolded successfully.")).toBeInTheDocument();
  });

  // ── Fix with Claude button visibility ──

  describe("Fix with Claude button", () => {
    it("shows when validate fails with missing tools error", () => {
      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      expect(screen.getByText("Fix with Claude")).toBeInTheDocument();
    });

    it("does NOT show for non-missing-tools errors", () => {
      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Parent directory does not exist",
        });
      });

      expect(screen.queryByText("Fix with Claude")).not.toBeInTheDocument();
    });

    it("does NOT show for errors on non-validate steps", () => {
      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "clone",
          status: "error",
          error: "Required tools not found: git. Please install them first.",
        });
      });

      expect(screen.queryByText("Fix with Claude")).not.toBeInTheDocument();
    });

    it("shows for multiple missing tools", () => {
      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm, uv, cargo. Please install them first.",
        });
      });

      expect(screen.getByText("Fix with Claude")).toBeInTheDocument();
    });
  });

  // ── Setup assistant session lifecycle ──

  describe("Setup assistant session", () => {
    async function renderWithMissingToolsError(
      template: TemplateEntry = TEMPLATE,
      missingTools = "pnpm",
    ) {
      const emitProgress = captureProgressEmitter();
      const result = render(
        <ScaffoldProgress {...defaultProps} template={template} />
      );

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: `Required tools not found: ${missingTools}. Please install them first.`,
        });
      });

      return result;
    }

    it("creates session and sets auto-accept mode on Fix with Claude click", async () => {
      captureChatEmitter(); // Pre-register so listenChatEvents has a handler
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      expect(mockCreateSession).toHaveBeenCalledWith("/tmp");
      expect(mockInitializeSession).toHaveBeenCalledWith("setup-1");
      expect(mockSetSessionMode).toHaveBeenCalledWith("setup-1", "auto-accept");
      expect(mockListenChatEvents).toHaveBeenCalledWith("setup-1", expect.any(Function));
      expect(mockSendMessage).toHaveBeenCalledWith("setup-1", expect.any(String));
    });

    it("sends prompt with template context", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      const prompt = mockSendMessage.mock.calls[0][1] as string;
      expect(prompt).toContain("my-project");
      expect(prompt).toContain("pnpm");
      expect(prompt).toContain("Next.js Full-Stack");
      expect(prompt).toContain("npm install");
      expect(prompt).toContain("npm run dev");
      expect(prompt).toContain("git-clone");
    });

    it("includes prerequisite check install hints in prompt", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError(TEMPLATE_WITH_CHECKS);

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      const prompt = mockSendMessage.mock.calls[0][1] as string;
      expect(prompt).toContain("npm install -g pnpm");
      expect(prompt).toContain("pnpm package manager");
    });

    it("hides Fix with Claude button after session starts", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      expect(screen.queryByText("Fix with Claude")).not.toBeInTheDocument();
    });

    it("shows mini-chat UI after session starts", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      // Chat input should be visible
      expect(screen.getByPlaceholderText("Ask Claude...")).toBeInTheDocument();
    });

    it("shows input as disabled while assistant is busy", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      // After clicking Fix, assistant is busy (waiting for response)
      const input = screen.getByPlaceholderText("Ask Claude...");
      expect(input).toBeDisabled();
    });

    it("shows stop button while assistant is busy", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      expect(screen.getByTitle("Stop")).toBeInTheDocument();
    });

    it("calls interruptSession when stop is clicked", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle("Stop"));
      });

      expect(mockInterruptSession).toHaveBeenCalledWith("setup-1");
    });

    it("does not show Continue Setup before turn completes", async () => {
      captureChatEmitter();
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      expect(screen.queryByText("Continue Setup")).not.toBeInTheDocument();
    });

    it("handles createSession failure gracefully", async () => {
      mockCreateSession.mockRejectedValueOnce(new Error("CLI not found"));
      await renderWithMissingToolsError();

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      // Should NOT show the chat UI — session creation failed
      expect(screen.queryByPlaceholderText("Ask Claude...")).not.toBeInTheDocument();
      // Fix with Claude should still be visible so user can retry
      expect(screen.getByText("Fix with Claude")).toBeInTheDocument();
    });
  });

  // ── Chat event handling ──

  describe("Chat events", () => {
    async function startSetupAssistant() {
      const emitProgress = captureProgressEmitter();
      const emitChat = captureChatEmitter();

      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      return emitChat;
    }

    it("shows assistant message after text_complete event", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "text_complete",
          session_id: "setup-1",
          full_text: "I installed pnpm successfully!",
        } as FrontendEvent);
      });

      expect(screen.getByText("I installed pnpm successfully!")).toBeInTheDocument();
    });

    it("shows Continue Setup button after turn_complete", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "text_complete",
          session_id: "setup-1",
          full_text: "Done installing.",
        } as FrontendEvent);
        emitChat({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 1000,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      expect(screen.getByText("Continue Setup")).toBeInTheDocument();
    });

    it("enables input after turn_complete", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 500,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      const input = screen.getByPlaceholderText("Ask Claude...");
      expect(input).not.toBeDisabled();
    });

    it("shows send button (not stop) after turn_complete", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 500,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      expect(screen.getByTitle("Send")).toBeInTheDocument();
      expect(screen.queryByTitle("Stop")).not.toBeInTheDocument();
    });

    it("enables input after process_error", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "process_error",
          session_id: "setup-1",
          error: "CLI crashed",
        } as FrontendEvent);
      });

      const input = screen.getByPlaceholderText("Ask Claude...");
      expect(input).not.toBeDisabled();
    });

    it("enables input after process_exited", async () => {
      const emitChat = await startSetupAssistant();

      act(() => {
        emitChat({
          type: "process_exited",
          session_id: "setup-1",
          code: 1,
        } as FrontendEvent);
      });

      const input = screen.getByPlaceholderText("Ask Claude...");
      expect(input).not.toBeDisabled();
    });
  });

  // ── User interaction in mini-chat ──

  describe("Mini-chat user interaction", () => {
    async function startAssistantAndCompleteTurn() {
      const emitProgress = captureProgressEmitter();
      const emitChat = captureChatEmitter();

      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      // Complete the first turn
      act(() => {
        emitChat({
          type: "text_complete",
          session_id: "setup-1",
          full_text: "Installed pnpm.",
        } as FrontendEvent);
        emitChat({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 500,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      return emitChat;
    }

    it("sends follow-up message when user types and clicks send", async () => {
      await startAssistantAndCompleteTurn();

      const input = screen.getByPlaceholderText("Ask Claude...");
      fireEvent.change(input, { target: { value: "Also install yarn" } });

      await act(async () => {
        fireEvent.click(screen.getByTitle("Send"));
      });

      expect(mockSendMessage).toHaveBeenCalledWith("setup-1", "Also install yarn");
    });

    it("sends follow-up message on Enter key", async () => {
      await startAssistantAndCompleteTurn();

      const input = screen.getByPlaceholderText("Ask Claude...");
      fireEvent.change(input, { target: { value: "check version" } });

      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(mockSendMessage).toHaveBeenCalledWith("setup-1", "check version");
    });

    it("clears input after sending", async () => {
      await startAssistantAndCompleteTurn();

      const input = screen.getByPlaceholderText("Ask Claude...");
      fireEvent.change(input, { target: { value: "hello" } });

      await act(async () => {
        fireEvent.click(screen.getByTitle("Send"));
      });

      expect(input).toHaveValue("");
    });

    it("disables send button when input is empty", async () => {
      await startAssistantAndCompleteTurn();

      const sendBtn = screen.getByTitle("Send");
      expect(sendBtn).toBeDisabled();
    });

    it("does not send on Shift+Enter", async () => {
      await startAssistantAndCompleteTurn();

      mockSendMessage.mockClear();

      const input = screen.getByPlaceholderText("Ask Claude...");
      fireEvent.change(input, { target: { value: "test" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ── Continue Setup ──

  describe("Continue Setup", () => {
    it("calls onRetry and closes session when clicked", async () => {
      const onRetry = vi.fn();
      const mockUnlisten = vi.fn();
      mockListenChatEvents.mockImplementationOnce(() => Promise.resolve(mockUnlisten));

      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} onRetry={onRetry} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      // We need to get the chat event handler — but we already consumed it above.
      // The listenChatEvents was called, so we need to get the handler from the call.
      const chatHandler = mockListenChatEvents.mock.calls[0][1] as (event: FrontendEvent) => void;

      act(() => {
        chatHandler({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 500,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Continue Setup"));
      });

      expect(mockUnlisten).toHaveBeenCalled();
      expect(mockCloseSession).toHaveBeenCalledWith("setup-1");
      expect(onRetry).toHaveBeenCalled();
    });

    it("hides mini-chat after Continue Setup is clicked", async () => {
      const mockUnlisten = vi.fn();
      mockListenChatEvents.mockImplementationOnce(() => Promise.resolve(mockUnlisten));

      const emitProgress = captureProgressEmitter();
      render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      const chatHandler = mockListenChatEvents.mock.calls[0][1] as (event: FrontendEvent) => void;

      act(() => {
        chatHandler({
          type: "turn_complete",
          session_id: "setup-1",
          duration_ms: 500,
          usage: null,
          cost_usd: null,
        } as FrontendEvent);
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Continue Setup"));
      });

      expect(screen.queryByPlaceholderText("Ask Claude...")).not.toBeInTheDocument();
      expect(screen.queryByText("Continue Setup")).not.toBeInTheDocument();
    });
  });

  // ── Session cleanup on unmount ──

  describe("Session cleanup", () => {
    it("closes session on unmount", async () => {
      const mockUnlisten = vi.fn();
      mockListenChatEvents.mockImplementationOnce(() => Promise.resolve(mockUnlisten));

      const emitProgress = captureProgressEmitter();
      const { unmount } = render(<ScaffoldProgress {...defaultProps} />);

      act(() => {
        emitProgress({
          step: "validate",
          status: "error",
          error: "Required tools not found: pnpm. Please install them first.",
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Fix with Claude"));
      });

      unmount();

      expect(mockUnlisten).toHaveBeenCalled();
      expect(mockCloseSession).toHaveBeenCalledWith("setup-1");
    });

    it("does not call closeSession on unmount when no session was started", () => {
      const { unmount } = render(<ScaffoldProgress {...defaultProps} />);
      unmount();

      expect(mockCloseSession).not.toHaveBeenCalled();
    });
  });

  // ── Template name display ──

  it("shows template name while in progress", () => {
    render(<ScaffoldProgress {...defaultProps} />);
    expect(screen.getByText("Template: Next.js Full-Stack")).toBeInTheDocument();
  });

  it("shows template name when finished", () => {
    render(<ScaffoldProgress {...defaultProps} resultPath="/tmp/my-project" />);
    expect(screen.getByText("Template: Next.js Full-Stack")).toBeInTheDocument();
  });
});
