import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantInputArea from "./AssistantInputArea";

// Mock dependent modules
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: vi.fn((selector) => {
    const state = { settings: { sendShortcut: "enter" } };
    return selector(state);
  }),
}));

vi.mock("../../lib/keyboard", () => ({
  shouldSend: vi.fn(() => false),
  sendShortcutLabel: vi.fn(() => "Enter"),
  sendShortcutHint: vi.fn(() => "Enter to send"),
}));

vi.mock("../../hooks/useClickOutside", () => ({
  useClickOutside: vi.fn(() => ({ current: null })),
}));

vi.mock("../../stores/assistantStore", () => ({
  useAssistantStore: {
    getState: vi.fn(() => ({
      addMessage: vi.fn(),
      clearMessages: vi.fn(),
    })),
  },
}));

vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      sessions: new Map(),
      sessionContext: new Map(),
      sessionStats: new Map(),
    })),
  },
}));

vi.mock("../../stores/uiStore", () => ({
  useUiStore: {
    getState: vi.fn(() => ({
      setCliOverlayInitialInput: vi.fn(),
      setCliOverlaySessionId: vi.fn(),
      setCliOverlayProjectPath: vi.fn(),
      setShowCliOverlay: vi.fn(),
    })),
  },
}));

vi.mock("../../lib/tauri-commands", () => ({
  discoverCommands: vi.fn(() => Promise.resolve([])),
  expandSkill: vi.fn(() => Promise.resolve({ prompt: "" })),
  pauseSessionProcess: vi.fn(() => Promise.resolve()),
  resumeSessionProcess: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/input-drafts", () => ({
  assistantInputDrafts: new Map(),
}));

vi.mock("./AssistantAttachmentBar", () => ({
  default: ({ attachments }: { attachments: unknown[] }) => (
    attachments.length > 0 ? <div data-testid="attachment-bar">Attachments: {attachments.length}</div> : null
  ),
}));

vi.mock("./AssistantCommandPalette", () => ({
  default: () => <div data-testid="command-palette">Commands</div>,
}));

describe("AssistantInputArea", () => {
  const defaultProps = {
    activeAssistantId: "a1",
    activeProjectPath: "/tmp/project",
    busy: false,
    isClaudeCode: false,
    currentAttachments: [] as never[],
    removeAssistantAttachment: vi.fn(),
    clearAssistantAttachments: vi.fn(),
    sendMessage: vi.fn(),
    cancelAssistant: vi.fn(),
    closeAssistant: vi.fn(),
    shortcuts: [],
    inputContainerRef: { current: null },
    dragOver: false,
    handlePaste: vi.fn(),
    handleFileDialog: vi.fn(),
    onInputChange: vi.fn(),
    input: "",
    textareaRef: { current: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders textarea", () => {
    render(<AssistantInputArea {...defaultProps} />);
    expect(screen.getByPlaceholderText("Ask the assistant...")).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<AssistantInputArea {...defaultProps} />);
    const sendBtn = screen.getByText("Send").closest("button")!;
    expect(sendBtn).toBeDisabled();
  });

  it("send button is not rendered when busy (stop button shown instead)", () => {
    render(<AssistantInputArea {...defaultProps} busy input="hello" />);
    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("sends message on send button click when input is non-empty", () => {
    const sendMessage = vi.fn();
    const onInputChange = vi.fn();
    render(
      <AssistantInputArea
        {...defaultProps}
        input="Hello world"
        sendMessage={sendMessage}
        onInputChange={onInputChange}
      />,
    );
    const sendBtn = screen.getByText("Send").closest("button")!;
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);
    expect(sendMessage).toHaveBeenCalledWith("a1", "Hello world", undefined);
  });

  it("shows attachment bar when attachments exist", () => {
    const attachments = [
      { id: "att1", fileName: "file.png", filePath: "/tmp/file.png", fileSize: 100, mimeType: "image/png", isImage: true },
    ];
    render(
      <AssistantInputArea
        {...defaultProps}
        currentAttachments={attachments}
      />,
    );
    expect(screen.getByTestId("attachment-bar")).toBeInTheDocument();
  });
});
