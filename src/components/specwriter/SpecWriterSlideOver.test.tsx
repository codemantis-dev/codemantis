import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecWriterSlideOver from "./SpecWriterSlideOver";
import { useSessionStore } from "../../stores/sessionStore";
import { useSpecWriterStore } from "../../stores/specWriterStore";

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
    });
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

  it("does not render content when closed", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: false, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    render(<SpecWriterSlideOver />);
    expect(screen.queryByTestId("spec-chat")).not.toBeInTheDocument();
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
});
