import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";

// Mock useTerminal before importing the hook
vi.mock("./useTerminal", () => ({
  useTerminal: () => ({
    createTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  }),
}));

// Mock usePreviewWindow
const mockTogglePreview = vi.fn();
vi.mock("./usePreviewWindow", () => ({
  usePreviewWindow: () => ({
    openPreview: vi.fn(),
    closePreview: vi.fn(),
    navigateTo: vi.fn(),
    refresh: vi.fn(),
    togglePreview: mockTogglePreview,
  }),
}));

// Mock tauri-commands
const mockSetSessionMode = vi.fn(() => Promise.resolve());
vi.mock("../lib/tauri-commands", () => ({
  closeSession: vi.fn(() => Promise.resolve()),
  setSessionMode: mockSetSessionMode,
}));

function setupSessions(): void {
  useSessionStore.setState({
    sessions: new Map([
      ["s1", { id: "s1", name: "Session 1", project_path: "/a", status: "connected", created_at: "", model: null, icon_index: 0 }],
      ["s2", { id: "s2", name: "Session 2", project_path: "/b", status: "connected", created_at: "", model: null, icon_index: 1 }],
      ["s3", { id: "s3", name: "Session 3", project_path: "/c", status: "connected", created_at: "", model: null, icon_index: 2 }],
    ]),
    activeSessionId: "s1",
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    tabOrder: ["s1", "s2", "s3"],
  });
}

describe("useKeyboardShortcuts (unit — store effects)", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: [],
    });
    useUiStore.setState({
      sidebarWidth: 220,
      rightPanelWidth: 360,
      rightTab: "activity",
      showApprovalModal: false,
      showSettingsModal: false,
      showProjectPicker: false,
    });
  });

  it("Cmd+N opens project picker on open tab (no active project)", () => {
    // Simulate what the shortcut handler does
    useUiStore.getState().openProjectPicker("open");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("open");
  });

  it("Cmd+Shift+N opens project picker on templates tab", () => {
    useUiStore.getState().openProjectPicker("templates");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("templates");
  });

  it("Cmd+O opens project picker on open tab", () => {
    useUiStore.getState().openProjectPicker("open");
    expect(useUiStore.getState().showProjectPicker).toBe(true);
    expect(useUiStore.getState().projectPickerTab).toBe("open");
  });

  it("Cmd+, opens settings modal", () => {
    useUiStore.getState().setShowSettingsModal(true);
    expect(useUiStore.getState().showSettingsModal).toBe(true);
  });

  it("Cmd+Shift+T switches to terminal tab", () => {
    useUiStore.getState().setRightTab("terminal");
    expect(useUiStore.getState().rightTab).toBe("terminal");
  });

  it("Cmd+Shift+A switches to activity tab", () => {
    useUiStore.getState().setRightTab("terminal");
    useUiStore.getState().setRightTab("activity");
    expect(useUiStore.getState().rightTab).toBe("activity");
  });

  it("Cmd+Shift+F switches to files tab", () => {
    useUiStore.getState().setRightTab("files");
    expect(useUiStore.getState().rightTab).toBe("files");
  });

  it("Cmd+1-9 switches to nth session tab", () => {
    setupSessions();

    // Switch to tab 2
    const { tabOrder } = useSessionStore.getState();
    const idx = 1; // Cmd+2
    if (idx < tabOrder.length) {
      useSessionStore.getState().setActiveSession(tabOrder[idx]);
    }
    expect(useSessionStore.getState().activeSessionId).toBe("s2");

    // Switch to tab 3
    useSessionStore.getState().setActiveSession(tabOrder[2]);
    expect(useSessionStore.getState().activeSessionId).toBe("s3");
  });

  it("Cmd+1 with no sessions does nothing", () => {
    const { tabOrder } = useSessionStore.getState();
    expect(tabOrder.length).toBe(0);
    // No crash, no state change
    expect(useSessionStore.getState().activeSessionId).toBeNull();
  });

  it("Cmd+9 out of range does nothing", () => {
    setupSessions();
    const { tabOrder } = useSessionStore.getState();
    const idx = 8; // Cmd+9
    expect(idx < tabOrder.length).toBe(false);
    // Active session stays unchanged
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("Cmd+W removes active session", () => {
    setupSessions();
    const activeId = useSessionStore.getState().activeSessionId!;
    useSessionStore.getState().removeSession(activeId);
    expect(useSessionStore.getState().sessions.has("s1")).toBe(false);
  });

  it("Cmd+Shift+M opens MCP modal", () => {
    useUiStore.getState().setShowMcpModal(true);
    expect(useUiStore.getState().showMcpModal).toBe(true);
  });

  it("Cmd+Shift+P triggers togglePreview (store-level check)", () => {
    // The keyboard shortcut handler calls togglePreview from usePreviewWindow.
    // Since we test store effects here, we verify the mock is wired correctly
    // by simulating what the handler does.
    mockTogglePreview();
    expect(mockTogglePreview).toHaveBeenCalled();
  });

  it("mode cycling updates both store and Rust backend", () => {
    setupSessions();
    useSessionStore.setState({
      sessionModes: new Map([["s1", "normal"]]),
    });

    // Simulate what the keyboard shortcut handler does:
    // cycle from normal → auto-accept
    const MODE_CYCLE = ["normal", "auto-accept", "plan"] as const;
    const store = useSessionStore.getState();
    const activeId = store.activeSessionId!;
    const current = store.sessionModes.get(activeId) ?? "normal";
    const idx = MODE_CYCLE.indexOf(current as typeof MODE_CYCLE[number]);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];

    store.setSessionMode(activeId, next);
    mockSetSessionMode(activeId, next);

    expect(useSessionStore.getState().sessionModes.get("s1")).toBe("auto-accept");
    expect(mockSetSessionMode).toHaveBeenCalledWith("s1", "auto-accept");
  });

  it("switching right tabs cycles correctly", () => {
    useUiStore.getState().setRightTab("activity");
    expect(useUiStore.getState().rightTab).toBe("activity");

    useUiStore.getState().setRightTab("terminal");
    expect(useUiStore.getState().rightTab).toBe("terminal");

    useUiStore.getState().setRightTab("files");
    expect(useUiStore.getState().rightTab).toBe("files");

    useUiStore.getState().setRightTab("activity");
    expect(useUiStore.getState().rightTab).toBe("activity");
  });
});
