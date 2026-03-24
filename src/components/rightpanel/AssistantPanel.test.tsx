import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import AssistantPanel from "./AssistantPanel";
import { useSessionStore } from "../../stores/sessionStore";
import { useAssistantStore } from "../../stores/assistantStore";

// Mock all child components
vi.mock("./AssistantTabs", () => ({
  default: () => <div data-testid="assistant-tabs" />,
}));
vi.mock("./AssistantAttachmentBar", () => ({
  default: () => <div data-testid="attachment-bar" />,
}));
vi.mock("./AssistantMessageMenu", () => ({
  default: () => <div data-testid="message-menu" />,
}));
vi.mock("./AssistantProviderMenu", () => ({
  default: ({ variant }: { variant: string }) => (
    <div data-testid={`provider-menu-${variant}`} />
  ),
}));
vi.mock("./AssistantCommandPalette", () => ({
  default: () => <div data-testid="command-palette" />,
}));
vi.mock("./AssistantChatMessages", () => ({
  default: () => <div data-testid="chat-messages" />,
}));

// Mock hooks
vi.mock("../../hooks/useAssistantSession", () => ({
  useAssistantSession: () => ({
    createAssistant: vi.fn(),
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    cancelAssistant: vi.fn(),
    closeAssistant: vi.fn(),
  }),
}));

vi.mock("../../hooks/useProviderMenu", () => ({
  useProviderMenu: () => ({
    showProviderMenu: false,
    setShowProviderMenu: vi.fn(),
    expandedProvider: null,
    setExpandedProvider: vi.fn(),
    handleCreate: vi.fn(),
  }),
}));

vi.mock("../../hooks/useAssistantShortcuts", () => ({
  useAssistantShortcuts: () => ({
    shortcutDraft: null,
    setShortcutDraft: vi.fn(),
    shortcutName: "",
    setShortcutName: vi.fn(),
    handleAddShortcut: vi.fn(),
    handleSaveShortcut: vi.fn(),
  }),
}));

vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: () => ({ current: null }),
}));

vi.mock("../../hooks/useFileDrop", () => ({
  useFileDrop: () => ({ isDragOver: false }),
}));

vi.mock("../../lib/tauri-commands", () => ({
  discoverCommands: vi.fn().mockResolvedValue([]),
  expandSkill: vi.fn(),
  pauseSessionProcess: vi.fn(),
  resumeSessionProcess: vi.fn(),
  saveClipboardImage: vi.fn(),
  getFileInfo: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../lib/input-drafts", () => ({
  assistantInputDrafts: new Map(),
}));

vi.mock("../../lib/file-utils", () => ({
  createPreviewUrl: vi.fn(),
  processDroppedPaths: vi.fn().mockResolvedValue([]),
}));

vi.mock("@radix-ui/react-dialog", () => {
  return {
    Root: ({ children }: { children: React.ReactNode }) => children,
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: () => null,
    Content: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    Title: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
  };
});

describe("AssistantPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeProjectPath: null,
      activeSessionId: null,
      sessions: new Map(),
      tabOrder: [],
    });
    useAssistantStore.setState({
      projectAssistants: new Map(),
      activeAssistantId: new Map(),
      messages: new Map(),
      streaming: new Map(),
      busy: new Map(),
      sessionCost: new Map(),
      attachments: new Map(),
    });
  });

  it("shows 'open a project' message when no project path", () => {
    render(<AssistantPanel />);
    expect(
      screen.getByText("Open a project to use the assistant")
    ).toBeInTheDocument();
  });

  it("shows empty state with provider menu when no assistants", () => {
    useSessionStore.setState({
      activeProjectPath: "/tmp/project",
      activeSessionId: "s1",
    });
    render(<AssistantPanel />);
    expect(screen.getByTestId("provider-menu-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Ask questions about your project/)
    ).toBeInTheDocument();
  });

  it("renders full panel with tabs and messages when assistants exist", () => {
    useSessionStore.setState({
      activeProjectPath: "/tmp/project",
      activeSessionId: "s1",
    });
    useAssistantStore.setState({
      projectAssistants: new Map([
        [
          "/tmp/project",
          [
            {
              id: "a1",
              projectPath: "/tmp/project",
              parentSessionId: "s1",
              name: "Test",
              provider: "claude-code",
              model: null,
              sortOrder: 0,
              createdAt: "2026-01-01",
            },
          ],
        ],
      ]),
      activeAssistantId: new Map([["s1", "a1"]]),
    });
    render(<AssistantPanel />);
    expect(screen.getByTestId("assistant-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("chat-messages")).toBeInTheDocument();
  });
});
