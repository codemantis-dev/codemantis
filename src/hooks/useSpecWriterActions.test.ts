import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpecWriterActions } from "./useSpecWriterActions";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSessionStore } from "../stores/sessionStore";
import { useGuideStore } from "../stores/guideStore";

// Mock hooks used internally
vi.mock("./useClaudeSession", () => ({
  useClaudeSession: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./useSpecConversationRouter", () => ({
  useSpecConversationRouter: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
  }),
}));

vi.mock("./useSpecConversation", () => ({
  useSpecConversation: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
  }),
}));

vi.mock("./useSpecConversationClaude", () => ({
  useSpecConversationClaude: () => ({
    sendMessage: vi.fn(),
    writeSpec: vi.fn(),
    generateAudit: vi.fn(),
    cancelStream: vi.fn(),
    loadContext: vi.fn(),
    changeModel: vi.fn(),
  }),
}));

vi.mock("../lib/tauri-commands", () => ({
  listSpecDocuments: vi.fn().mockResolvedValue([]),
  gatherSpecContext: vi.fn().mockResolvedValue("context"),
  saveTaskBoardState: vi.fn().mockResolvedValue(undefined),
  addVerificationWorkflowToClaudeMd: vi.fn().mockResolvedValue("added"),
  loadTaskBoardState: vi.fn().mockResolvedValue(null),
}));

const mockShowToast = vi.fn();
vi.mock("../stores/toastStore", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

const PROJECT_PATH = "/tmp/test-project";

function resetStores(): void {
  useSessionStore.setState({
    activeProjectPath: PROJECT_PATH,
    activeSessionId: "session-1",
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
}

describe("useSpecWriterActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it("returns all expected action handlers", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    expect(result.current.handleClose).toBeInstanceOf(Function);
    expect(result.current.handleReset).toBeInstanceOf(Function);
    expect(result.current.handleWriteSpec).toBeInstanceOf(Function);
    expect(result.current.handleGenerateAudit).toBeInstanceOf(Function);
    expect(result.current.handleSpecEdit).toBeInstanceOf(Function);
    expect(result.current.handleCloseSpec).toBeInstanceOf(Function);
    expect(result.current.handleToggleEdit).toBeInstanceOf(Function);
    expect(result.current.handleSuggestFeatures).toBeInstanceOf(Function);
    expect(result.current.handlePromoteToSpec).toBeInstanceOf(Function);
    expect(result.current.openSaveSpecDialog).toBeInstanceOf(Function);
    expect(result.current.openSaveAuditDialog).toBeInstanceOf(Function);
    expect(result.current.handleSaved).toBeInstanceOf(Function);
    expect(result.current.handleOptionAction).toBeInstanceOf(Function);
    expect(result.current.handleUseGuide).toBeInstanceOf(Function);
    expect(result.current.handleLoadSpec).toBeInstanceOf(Function);
    expect(result.current.sendSpecMessage).toBeInstanceOf(Function);
    expect(result.current.writeSpec).toBeInstanceOf(Function);
    expect(result.current.cancelStream).toBeInstanceOf(Function);
  });

  it("initializes with default state values", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    expect(result.current.showSaveDialog).toBe(false);
    expect(result.current.saveDialogType).toBe("spec");
    expect(result.current.lastSavedFile).toBeNull();
    expect(result.current.isEditing).toBe(false);
    expect(result.current.pendingGuideLoad).toBeNull();
    expect(result.current.contextError).toBeNull();
    expect(result.current.hasGuide).toBe(false);
  });

  // ── handleClose ──

  it("handleClose persists state and closes slide-over", () => {
    useSpecWriterStore.setState({
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: null }]]),
    });
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handleClose());
    const state = useSpecWriterStore.getState();
    expect(state.uiState.get(PROJECT_PATH)?.is_open).toBe(false);
  });

  // ── handleReset ──

  it("handleReset clears conversation and spec content", () => {
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
      currentSpecContent: new Map([[PROJECT_PATH, "# Spec"]]),
      currentAuditContent: new Map([[PROJECT_PATH, "# Audit"]]),
      draftText: new Map([[PROJECT_PATH, "draft"]]),
      draftAttachments: new Map([[PROJECT_PATH, []]]),
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handleReset());

    const state = useSpecWriterStore.getState();
    expect(state.conversations.has(PROJECT_PATH)).toBe(false);
    expect(state.currentSpecContent.get(PROJECT_PATH) ?? null).toBeNull();
    expect(state.currentAuditContent.get(PROJECT_PATH) ?? null).toBeNull();
    expect(state.draftText.has(PROJECT_PATH)).toBe(false);
  });

  // ── handleSpecEdit ──

  it("handleSpecEdit updates spec content in store", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handleSpecEdit("# New Spec Content"));
    expect(useSpecWriterStore.getState().currentSpecContent.get(PROJECT_PATH)).toBe("# New Spec Content");
  });

  // ── handleCloseSpec ──

  it("handleCloseSpec clears spec/audit content and editing state", () => {
    useSpecWriterStore.setState({
      currentSpecContent: new Map([[PROJECT_PATH, "# Spec"]]),
      currentAuditContent: new Map([[PROJECT_PATH, "# Audit"]]),
      uiState: new Map([[PROJECT_PATH, { is_open: true, chat_width: 40, current_spec_content: null, selected_saved_spec: "test.md" }]]),
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handleCloseSpec());

    const state = useSpecWriterStore.getState();
    expect(state.currentSpecContent.get(PROJECT_PATH) ?? null).toBeNull();
    expect(state.currentAuditContent.get(PROJECT_PATH) ?? null).toBeNull();
    expect(state.uiState.get(PROJECT_PATH)?.selected_saved_spec ?? null).toBeNull();
  });

  // ── handleToggleEdit ──

  it("handleToggleEdit toggles editing state", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    expect(result.current.isEditing).toBe(false);
    act(() => result.current.handleToggleEdit());
    expect(result.current.isEditing).toBe(true);
    act(() => result.current.handleToggleEdit());
    expect(result.current.isEditing).toBe(false);
  });

  // ── openSaveSpecDialog / openSaveAuditDialog ──

  it("openSaveSpecDialog opens dialog with spec type", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.openSaveSpecDialog());
    expect(result.current.showSaveDialog).toBe(true);
    expect(result.current.saveDialogType).toBe("spec");
  });

  it("openSaveAuditDialog opens dialog with audit type", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.openSaveAuditDialog());
    expect(result.current.showSaveDialog).toBe(true);
    expect(result.current.saveDialogType).toBe("audit");
  });

  // ── handlePromoteToSpec ──

  it("handlePromoteToSpec calls store and shows toast", () => {
    useSpecWriterStore.setState({
      conversations: new Map([[PROJECT_PATH, {
        id: "c1",
        project_path: PROJECT_PATH,
        messages: [{
          id: "m1", role: "assistant" as const,
          content: "# Feature Spec\nSome content",
          message_type: "conversation" as const,
          timestamp: "2026-01-01",
        }],
        ai_provider: "gemini",
        ai_model: "gemini-2.5-flash",
        status: "done" as const,
        mode: "feature" as const,
        context_loaded: true,
      }]]),
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handlePromoteToSpec("m1"));
    expect(mockShowToast).toHaveBeenCalledWith("Message promoted to spec preview", "success");
  });

  // ── handleOptionAction ──

  it("handleOptionAction returns false for unknown options", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    const handled = result.current.handleOptionAction("Unknown option");
    expect(handled).toBe(false);
  });

  it("handleOptionAction returns true for 'No, skip this'", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    const handled = result.current.handleOptionAction("No, skip this");
    expect(handled).toBe(true);
  });

  // ── handleLoadSpec ──

  it("handleLoadSpec sets content and adds system message", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));
    act(() => result.current.handleLoadSpec("# Loaded Spec", "feature.md"));

    const state = useSpecWriterStore.getState();
    expect(state.currentSpecContent.get(PROJECT_PATH)).toBe("# Loaded Spec");
  });

  // ── null project path ──

  it("actions are safe to call with null project path", () => {
    const { result } = renderHook(() => useSpecWriterActions(null));
    // These should not throw
    act(() => result.current.handleClose());
    act(() => result.current.handleReset());
    act(() => result.current.handleSpecEdit("test"));
    act(() => result.current.handleCloseSpec());
    expect(result.current.hasGuide).toBe(false);
  });

  // ── hasGuide derivation ──

  it("hasGuide is true when lastSavedFile matches guide specFilename", () => {
    useGuideStore.setState({
      guide: {
        id: "g1",
        projectPath: PROJECT_PATH,
        specFilename: "feature.md",
        auditFilename: null,
        title: "Test",
        sessions: [],
        createdAt: "2026-01-01",
        status: "active",
      },
    });

    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    // Initially no saved file, so hasGuide is false
    expect(result.current.hasGuide).toBe(false);

    // After saving, the handleSaved callback sets lastSavedFile
    act(() => result.current.handleSaved("feature.md"));
    expect(result.current.hasGuide).toBe(true);
  });

  // ── handleSaved ──

  it("handleSaved closes save dialog and sets lastSavedFile for spec type", () => {
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    // Open dialog first
    act(() => result.current.openSaveSpecDialog());
    expect(result.current.showSaveDialog).toBe(true);

    // Save
    act(() => result.current.handleSaved("feature-spec.md"));
    expect(result.current.showSaveDialog).toBe(false);
    expect(result.current.lastSavedFile).toBe("feature-spec.md");
  });

  // ── handleSendToChat with no session ──

  it("handleSendToChat shows error when no active session", async () => {
    useSessionStore.setState({ activeSessionId: null });
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleSendToChat();
    });
    expect(mockShowToast).toHaveBeenCalledWith("No active chat session", "error");
  });

  // ── handleImplement with no session ──

  it("handleImplement shows error when no active session", async () => {
    useSessionStore.setState({ activeSessionId: null });
    const { result } = renderHook(() => useSpecWriterActions(PROJECT_PATH));

    await act(async () => {
      await result.current.handleImplement();
    });
    expect(mockShowToast).toHaveBeenCalledWith("No active chat session", "error");
  });
});
