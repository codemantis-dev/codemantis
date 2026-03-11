import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";
import { useSessionStore } from "./stores/sessionStore";
import { useUiStore } from "./stores/uiStore";

// Mock tauri commands — must include all commands used transitively by stores/hooks
vi.mock("./lib/tauri-commands", () => ({
  checkClaudeStatus: vi.fn(() =>
    Promise.resolve({ installed: true, version: "1.0.0", authenticated: true, binary_path: "/usr/local/bin/claude" })
  ),
  cleanupOldAttachments: vi.fn(() => Promise.resolve(0)),
  listTemplates: vi.fn(() => Promise.resolve([])),
  listenScaffoldProgress: vi.fn(() => Promise.resolve(() => {})),
  createSession: vi.fn(() => Promise.resolve({ id: "s1", name: "Test", project_path: "/tmp", status: "connected", created_at: "", model: null, icon_index: 0 })),
  listenChatEvents: vi.fn(() => Promise.resolve(() => {})),
  listenActivityEvents: vi.fn(() => Promise.resolve(() => {})),
  listenToolApprovalRequests: vi.fn(() => Promise.resolve(() => {})),
  getSettings: vi.fn(() => Promise.resolve({
    theme: "dark", fontSize: 14, sendShortcut: "enter", terminalShell: null,
    terminalFontSize: 13, quickCommands: [], changelogEnabled: false,
    changelogProvider: "gemini", changelogApiKeys: {}, changelogPrompt: "",
    assistantShortcuts: [],
  })),
  updateSettings: vi.fn(() => Promise.resolve()),
}));

// Mock tauri dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

// Mock hooks that have complex tauri dependencies
vi.mock("./hooks/useClaudeSession", () => ({
  useClaudeSession: () => ({
    startSession: vi.fn(),
    addSessionToProject: vi.fn(),
    closeSession: vi.fn(),
    closeAllSessionsInProject: vi.fn(),
  }),
}));

// Mock heavy components to keep tests focused
vi.mock("./components/layout/AppShell", () => ({
  default: () => <div data-testid="app-shell">AppShell</div>,
}));
vi.mock("./components/modals/ToolApproval", () => ({
  default: () => null,
}));
vi.mock("./components/modals/ProjectPicker", () => ({
  default: () => null,
  addRecentProject: vi.fn(),
  getRecentProjects: () => {
    try {
      const stored = localStorage.getItem("codemantis-recent-projects");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  },
}));
vi.mock("./components/modals/QuestionModal", () => ({
  default: () => null,
}));
vi.mock("./components/modals/CliOverlay", () => ({
  default: () => null,
}));
vi.mock("./components/modals/SettingsModal", () => ({
  default: () => null,
}));
vi.mock("./components/modals/McpModal", () => ({
  default: () => null,
}));
vi.mock("./components/shared/Toast", () => ({
  default: () => null,
}));
vi.mock("./hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn(),
}));
vi.mock("./hooks/useToolApprovalListener", () => ({
  useToolApprovalListener: vi.fn(),
}));

// Define global __APP_VERSION__ that Vite normally provides
// @ts-expect-error Vite global define
globalThis.__APP_VERSION__ = "0.4.1";

describe("App welcome screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSessionStore.setState({
      tabOrder: [],
      sessions: new Map(),
      activeSessionId: null,
    });
    useUiStore.setState({
      showProjectPicker: false,
      projectPickerTab: "templates",
    });
  });

  it("shows welcome screen when no sessions", async () => {
    render(<App />);
    expect(await screen.findByText("CodeMantis")).toBeInTheDocument();
  });

  it("renders New Project card", async () => {
    render(<App />);
    expect(await screen.findByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("Start from a template")).toBeInTheDocument();
  });

  it("renders Open Project card", async () => {
    render(<App />);
    expect(await screen.findByText("Open Project")).toBeInTheDocument();
    expect(screen.getByText("Open an existing folder")).toBeInTheDocument();
  });

  it("opens project picker on Templates tab when New Project is clicked", async () => {
    render(<App />);
    const newBtn = await screen.findByText("New Project");
    fireEvent.click(newBtn);
    const state = useUiStore.getState();
    expect(state.showProjectPicker).toBe(true);
    expect(state.projectPickerTab).toBe("templates");
  });

  it("opens project picker on Open tab when Open Project is clicked", async () => {
    render(<App />);
    const openBtn = await screen.findByText("Open Project");
    fireEvent.click(openBtn);
    const state = useUiStore.getState();
    expect(state.showProjectPicker).toBe(true);
    expect(state.projectPickerTab).toBe("open");
  });

  it("shows keyboard shortcut hints", async () => {
    render(<App />);
    expect(await screen.findByText("Cmd+Shift+N")).toBeInTheDocument();
    expect(screen.getByText("Cmd+O")).toBeInTheDocument();
  });

  it("shows recent projects on welcome screen", async () => {
    localStorage.setItem(
      "codemantis-recent-projects",
      JSON.stringify(["/Users/test/my-app", "/Users/test/other-project"])
    );
    render(<App />);
    expect(await screen.findByText("Recent Projects")).toBeInTheDocument();
    expect(screen.getByText("my-app")).toBeInTheDocument();
    expect(screen.getByText("other-project")).toBeInTheDocument();
  });

  it("does not show Recent Projects section when empty", async () => {
    render(<App />);
    await screen.findByText("CodeMantis");
    expect(screen.queryByText("Recent Projects")).not.toBeInTheDocument();
  });

  it("shows AppShell when sessions exist", async () => {
    useSessionStore.setState({
      tabOrder: ["s1"],
      sessions: new Map([["s1", { id: "s1", name: "Test", project_path: "/tmp", status: "connected", created_at: "", model: null, icon_index: 0 }]]),
      activeSessionId: "s1",
    });
    render(<App />);
    expect(await screen.findByTestId("app-shell")).toBeInTheDocument();
  });
});
