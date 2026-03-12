import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import AppShell from "./AppShell";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

// Mock hooks and commands that trigger async state updates on mount
vi.mock("../../hooks/useFileTree", () => ({
  useFileTree: () => ({ files: [], loading: false, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useGitStatus", () => ({
  useGitStatus: () => ({ gitStatus: null, refresh: vi.fn() }),
}));
vi.mock("../../lib/tauri-commands", () => ({
  discoverCommands: vi.fn(() => Promise.resolve([])),
  readFileContent: vi.fn(() => Promise.resolve("")),
  getFileInfo: vi.fn(() => Promise.resolve(null)),
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
