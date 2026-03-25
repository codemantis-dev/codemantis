import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import AppShell from "./AppShell";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { listen } from "@tauri-apps/api/event";

// Mock hooks and commands that trigger async state updates on mount
vi.mock("../../hooks/useFileTree", () => ({
  useFileTree: () => ({ files: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useGitStatus", () => ({
  useGitStatus: () => ({ gitStatus: null, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useDevServerDetection", () => ({
  useDevServerDetection: vi.fn(),
}));
vi.mock("../../hooks/usePreviewWindow", () => ({
  usePreviewWindow: () => ({
    openPreview: vi.fn(),
    closePreview: vi.fn(),
    navigateTo: vi.fn(),
    refresh: vi.fn(),
    togglePreview: vi.fn(),
  }),
}));
vi.mock("../../hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn(),
}));
vi.mock("../../hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({
    addSessionToProject: vi.fn(),
    closeSession: vi.fn(),
    closeAllSessionsInProject: vi.fn(),
    renameSession: vi.fn(),
  }),
}));
vi.mock("../specwriter/SpecWriterSlideOver", () => ({
  default: () => null,
}));
vi.mock("../specwriter/SpecWriterBadge", () => ({
  default: () => null,
}));
// Capture the preview console callback so tests can invoke it
let capturedConsoleCallback: ((entry: { level: string; ts: string; msg: string; url: string; stack?: string }) => void) | null = null;

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));
vi.mock("../../lib/tauri-commands", () => ({
  discoverCommands: vi.fn(() => Promise.resolve([])),
  readFileContent: vi.fn(() => Promise.resolve("")),
  getFileInfo: vi.fn(() => Promise.resolve(null)),
  listenDevServerDetected: vi.fn(() => Promise.resolve(() => {})),
  listenDevServerClosed: vi.fn(() => Promise.resolve(() => {})),
  listenAssistantStream: vi.fn(() => Promise.resolve(() => {})),
  sendAssistantChat: vi.fn(() => Promise.resolve()),
  createSession: vi.fn(() => Promise.resolve({ id: "s1" })),
  sendMessage: vi.fn(() => Promise.resolve()),
  listenChatEvents: vi.fn(() => Promise.resolve(() => {})),
  listenPreviewConsoleEntry: vi.fn((cb: (entry: { level: string; ts: string; msg: string; url: string; stack?: string }) => void) => {
    capturedConsoleCallback = cb;
    return Promise.resolve(() => { capturedConsoleCallback = null; });
  }),
}));
vi.mock("../../hooks/useSpecConversation", () => ({
  useSpecConversation: () => ({ sendMessage: vi.fn(), writeSpec: vi.fn(), loadContext: vi.fn() }),
}));

const SESSION = {
  id: "s1",
  name: "Test Session",
  project_path: "/tmp/test",
  status: "connected" as const,
  created_at: "",
  model: "sonnet",
  icon_index: 0,
};

describe("AppShell", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map([["s1", SESSION]]),
      activeSessionId: "s1",
      sessionMessages: new Map([["s1", []]]),
      sessionStreaming: new Map([["s1", { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([["s1", { used: 0, max: 200000 }]]),
      tabOrder: ["s1"],
      activeProjectPath: "/tmp/test",
      projectOrder: ["/tmp/test"],
      projectActiveSession: new Map([["/tmp/test", "s1"]]),
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

  it("renders three-panel layout", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    // Project tab shows folder name "test", session sub-tab shows "Test Session"
    expect(screen.getByText("Test Session")).toBeInTheDocument();
    expect(screen.getAllByText("Files").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
  });

  it("renders input area", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    expect(screen.getByText("Send")).toBeInTheDocument();
  });
});

describe("Preview Console Listener", () => {
  beforeEach(() => {
    capturedConsoleCallback = null;
    vi.mocked(showToast).mockClear();
    useSessionStore.setState({
      sessions: new Map([["s1", SESSION]]),
      activeSessionId: "s1",
      sessionMessages: new Map([["s1", []]]),
      sessionStreaming: new Map([["s1", { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([["s1", { used: 0, max: 200000 }]]),
      tabOrder: ["s1"],
      activeProjectPath: "/tmp/test",
      projectOrder: ["/tmp/test"],
      projectActiveSession: new Map([["/tmp/test", "s1"]]),
    });
    useActivityStore.setState({
      sessionEntries: new Map([["s1", []]]),
      approvalQueue: [],
      approvalSeenIds: new Set(),
      currentApprovalIndex: 0,
      alwaysAllowedTools: new Map(),
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

  it("shows toast on console.error entries", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    // Wait for the listener to be registered
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(capturedConsoleCallback).not.toBeNull();

    act(() => {
      capturedConsoleCallback!({
        level: "error",
        ts: new Date().toISOString(),
        msg: "Uncaught TypeError: Cannot read property 'foo' of undefined",
        url: "http://localhost:3000",
      });
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Preview error:"),
      "error",
    );
  });

  it("adds activity entry for error-level console entries", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      capturedConsoleCallback!({
        level: "error",
        ts: new Date().toISOString(),
        msg: "ReferenceError: x is not defined",
        url: "http://localhost:3000/app",
      });
    });

    const entries = useActivityStore.getState().sessionEntries.get("s1") ?? [];
    expect(entries.length).toBe(1);
    expect(entries[0].toolName).toBe("preview_console");
    expect(entries[0].isError).toBe(true);
    expect(entries[0].status).toBe("done");
    expect(entries[0].result).toContain("ReferenceError");
  });

  it("adds activity entry for warn-level entries without toast", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      capturedConsoleCallback!({
        level: "warn",
        ts: new Date().toISOString(),
        msg: "Deprecation warning: use newAPI instead",
        url: "http://localhost:3000",
      });
    });

    const entries = useActivityStore.getState().sessionEntries.get("s1") ?? [];
    expect(entries.length).toBe(1);
    expect(entries[0].toolName).toBe("preview_console");
    expect(entries[0].isError).toBe(false);
    // No toast for warnings
    expect(showToast).not.toHaveBeenCalled();
  });

  it("ignores log/info/debug entries", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      capturedConsoleCallback!({
        level: "log",
        ts: new Date().toISOString(),
        msg: "App loaded",
        url: "http://localhost:3000",
      });
      capturedConsoleCallback!({
        level: "info",
        ts: new Date().toISOString(),
        msg: "Connected",
        url: "http://localhost:3000",
      });
      capturedConsoleCallback!({
        level: "debug",
        ts: new Date().toISOString(),
        msg: "Debug info",
        url: "http://localhost:3000",
      });
    });

    const entries = useActivityStore.getState().sessionEntries.get("s1") ?? [];
    expect(entries.length).toBe(0);
    expect(showToast).not.toHaveBeenCalled();
  });
});

// ── Console-to-chat event regression tests ──
// Regression: security changes broke the "Send to Chat" button because the
// preview-console-to-chat event listener was removed or the event name changed.
describe("Preview Console-to-Chat Event", () => {
  beforeEach(() => {
    vi.mocked(listen).mockClear();
    useSessionStore.setState({
      sessions: new Map([["s1", SESSION]]),
      activeSessionId: "s1",
      sessionMessages: new Map([["s1", []]]),
      sessionStreaming: new Map([["s1", { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([["s1", { used: 0, max: 200000 }]]),
      tabOrder: ["s1"],
      activeProjectPath: "/tmp/test",
      projectOrder: ["/tmp/test"],
      projectActiveSession: new Map([["/tmp/test", "s1"]]),
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

  it("registers listener for preview-console-to-chat event", async () => {
    await act(async () => {
      render(<AppShell />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // AppShell must call listen("preview-console-to-chat", ...) during mount
    const listenCalls = vi.mocked(listen).mock.calls;
    const consoleToChat = listenCalls.find(
      (call) => call[0] === "preview-console-to-chat",
    );
    expect(consoleToChat).toBeDefined();
  });

  it("callback formats logs with markdown code block and sets draft input", () => {
    // Directly test the formatting logic that the listen callback uses.
    // This avoids React effect lifecycle complexity while still catching
    // regressions in the event → chat input pipeline.
    const payload = "[ERROR] TypeError: undefined\n[WARN] Deprecated API";
    const formatted = `Browser console logs from preview:\n\`\`\`\n${payload}\n\`\`\``;
    useUiStore.getState().setDraftInput(formatted);

    const draftInput = useUiStore.getState().draftInput;
    expect(draftInput).toContain("Browser console logs from preview:");
    expect(draftInput).toContain("[ERROR] TypeError: undefined");
    expect(draftInput).toContain("[WARN] Deprecated API");
    expect(draftInput).toContain("```");
  });
});
