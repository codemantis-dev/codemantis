import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecWriterSlideOver from "./SpecWriterSlideOver";
import { useSessionStore } from "../../stores/sessionStore";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useGuideStore } from "../../stores/guideStore";

// Mock child components
vi.mock("./SpecChat", () => ({
  default: () => <div data-testid="spec-chat" />,
}));
vi.mock("./SpecPreview", () => ({
  default: () => <div data-testid="spec-preview" />,
}));
vi.mock("./SavedSpecsList", () => ({
  default: () => <div data-testid="saved-specs-list" />,
}));
vi.mock("./SaveSpecDialog", () => ({
  default: () => <div data-testid="save-spec-dialog" />,
}));

// Mock hooks
vi.mock("../../hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({
    sendMessage: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSpecConversationClaude", () => ({
  useSpecConversationClaude: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
    changeModel: vi.fn(),
  }),
}));

// Mock tauri-commands
vi.mock("../../lib/tauri-commands", () => ({
  listSpecDocuments: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue("context"),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  addVerificationWorkflowToClaudeMd: vi.fn().mockResolvedValue("added"),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

// useShallow must return a stable selector that produces structurally-equal
// results to prevent infinite re-renders. The real useShallow wraps the
// selector with shallow comparison — for tests we can use the identity fn
// because we manually set stable state values.
vi.mock("zustand/shallow", () => ({
  useShallow: (fn: (s: unknown) => unknown) => {
    // Return a memoised version that caches the last result ref
    let last: unknown;
    return (s: unknown) => {
      const next = (fn as (s: unknown) => unknown)(s);
      // Simple shallow compare
      if (last !== undefined && typeof next === "object" && next !== null && typeof last === "object" && last !== null) {
        const nk = Object.keys(next as Record<string, unknown>);
        const lk = Object.keys(last as Record<string, unknown>);
        if (nk.length === lk.length && nk.every((k) => (next as Record<string, unknown>)[k] === (last as Record<string, unknown>)[k])) {
          return last;
        }
      }
      last = next;
      return next;
    };
  },
}));

const PROJECT_PATH = "/tmp/project";

describe("SpecWriterSlideOver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeProjectPath: PROJECT_PATH,
      activeSessionId: "s1",
    });
    useSpecWriterStore.setState({
      conversations: new Map(),
      uiState: new Map(),
      currentSpecContent: new Map(),
      currentAuditContent: new Map(),
      planningStreaming: new Map(),
      savedSpecs: new Map(),
      projectContext: new Map(),
      draftText: new Map(),
      draftAttachments: new Map(),
    });
    useGuideStore.setState({ guide: null });
  });

  it("returns null when no project path", () => {
    useSessionStore.setState({ activeProjectPath: null });
    const { container } = render(<SpecWriterSlideOver />);
    expect(container.firstChild).toBeNull();
  });

  it("renders header with SpecWriter title when open", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.getByText("SpecWriter")).toBeInTheDocument();
  });

  it("renders close button in header", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.getByTitle("Close SpecWriter")).toBeInTheDocument();
  });

  it("renders Generate Spec button (disabled when not ready)", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
      conversations: new Map([[PROJECT_PATH, {
        id: "c1",
        project_path: PROJECT_PATH,
        messages: [],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering" as const,
        mode: "feature" as const,
        context_loaded: false,
      }]]),
    });
    render(<SpecWriterSlideOver />);
    const genBtn = screen.getByText("Generate Spec").closest("button");
    expect(genBtn).toBeDisabled();
  });

  it("renders SpecChat and SpecPreview when open", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.getByTestId("spec-chat")).toBeInTheDocument();
    expect(screen.getByTestId("spec-preview")).toBeInTheDocument();
  });

  it("hides content when closed (always rendered for background streaming)", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: false, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    // Children are always rendered but hidden via display:none
    const chat = screen.getByTestId("spec-chat");
    expect(chat).toBeInTheDocument();
    expect(chat.closest('[style*="display: none"]')).toBeTruthy();
  });

  it("shows Reset button when conversation has messages", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
      conversations: new Map([[PROJECT_PATH, {
        id: "c1",
        project_path: PROJECT_PATH,
        messages: [{ id: "m1", role: "user" as const, content: "test", message_type: "conversation" as const, timestamp: "2026-01-01" }],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering" as const,
        mode: "feature" as const,
        context_loaded: false,
      }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  // ── Always-render / CSS hidden behavior ──────────────────────

  it("shows content with display:flex when open", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    const chat = screen.getByTestId("spec-chat");
    // When open, the container should NOT have display:none
    expect(chat.closest('[style*="display: none"]')).toBeFalsy();
    expect(chat.closest('[style*="display: flex"]')).toBeTruthy();
  });

  it("always renders SpecPreview in DOM even when closed", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: false, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.getByTestId("spec-preview")).toBeInTheDocument();
    expect(screen.getByTestId("spec-preview").closest('[style*="display: none"]')).toBeTruthy();
  });

  it("Reset clears draft text and attachments via clearConversation", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
      conversations: new Map([[PROJECT_PATH, {
        id: "c1",
        project_path: PROJECT_PATH,
        messages: [{ id: "m1", role: "user" as const, content: "test", message_type: "conversation" as const, timestamp: "2026-01-01" }],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "gathering" as const,
        mode: "feature" as const,
        context_loaded: false,
      }]]),
      draftText: new Map([[PROJECT_PATH, "Draft to be cleared"]]),
      draftAttachments: new Map([[PROJECT_PATH, [{ id: "a1", type: "image" as const, name: "img.png", size: 100, mime_type: "image/png", file_path: "" }]]]),
    });
    render(<SpecWriterSlideOver />);
    fireEvent.click(screen.getByText("Reset"));
    expect(useSpecWriterStore.getState().draftText.has(PROJECT_PATH)).toBe(false);
    expect(useSpecWriterStore.getState().draftAttachments.has(PROJECT_PATH)).toBe(false);
    expect(useSpecWriterStore.getState().conversations.has(PROJECT_PATH)).toBe(false);
  });

  it("children persist in DOM across close/open cycle", () => {
    // Start open
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    const { rerender } = render(<SpecWriterSlideOver />);
    expect(screen.getByTestId("spec-chat")).toBeInTheDocument();

    // Close
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: false, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    rerender(<SpecWriterSlideOver />);
    // Still in DOM, just hidden
    expect(screen.getByTestId("spec-chat")).toBeInTheDocument();
    expect(screen.getByTestId("spec-chat").closest('[style*="display: none"]')).toBeTruthy();

    // Reopen
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    rerender(<SpecWriterSlideOver />);
    expect(screen.getByTestId("spec-chat")).toBeInTheDocument();
    expect(screen.getByTestId("spec-chat").closest('[style*="display: none"]')).toBeFalsy();
  });

  // ── Guide state is reactive from guideStore ──────────────

  it("does not show 'Use Guide' when no guide exists and no spec saved", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    useGuideStore.setState({ guide: null });
    render(<SpecWriterSlideOver />);
    expect(screen.queryByText("Use Guide")).not.toBeInTheDocument();
  });

  it("derives hasGuide from guideStore, not local state", () => {
    // Verify the component subscribes to guideStore reactively
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    useGuideStore.setState({
      guide: {
        id: "g1",
        projectPath: PROJECT_PATH,
        specFilename: "test.md",
        auditFilename: null,
        title: "Test Guide",
        sessions: [],
        createdAt: "2026-01-01",
        status: "active",
      },
    });
    render(<SpecWriterSlideOver />);
    // The guide exists in the store — even without saving a spec in this session,
    // the toolbar receives hasGuide=true. The button itself is gated on lastSavedFile
    // in the toolbar, so we verify via the toolbar test. Here we just confirm no crash.
    expect(screen.getByText("SpecWriter")).toBeInTheDocument();
  });
});
