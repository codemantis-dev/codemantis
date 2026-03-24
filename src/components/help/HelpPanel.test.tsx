import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import HelpPanel from "./HelpPanel";

const mockInitHelpSession = vi.fn();
const mockSendHelpMessage = vi.fn();

vi.mock("../../hooks/useHelpSession", () => ({
  useHelpSession: () => ({
    initHelpSession: mockInitHelpSession,
    sendHelpMessage: mockSendHelpMessage,
  }),
}));

vi.mock("../../lib/tauri-commands", () => ({
  interruptSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./HelpWelcome", () => ({
  default: ({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) => (
    <div data-testid="help-welcome">
      <button onClick={() => onSuggestionClick("test suggestion")}>Suggestion</button>
    </div>
  ),
}));

vi.mock("./HelpChat", () => ({
  default: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="help-chat">{sessionId}</div>
  ),
}));

vi.mock("./HelpChatInput", () => ({
  default: ({ onSend }: { onSend: (msg: string) => void }) => (
    <div data-testid="help-input">
      <button onClick={() => onSend("hello")}>Send</button>
    </div>
  ),
}));

vi.mock("../../lib/empty-refs", () => ({
  EMPTY_ARRAY: [],
}));

describe("HelpPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({
      helpPanelOpen: false,
      helpSessionId: null,
      helpSessionReady: false,
      helpError: null,
      helpShowWelcome: true,
    });
    useSessionStore.setState({
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionBusy: new Map(),
    });
  });

  it("renders the panel header with title", () => {
    useUiStore.setState({ helpPanelOpen: true });
    render(<HelpPanel />);
    expect(screen.getByText("CodeMantis Help")).toBeInTheDocument();
  });

  it("shows loading state when panel is open but session not ready", () => {
    useUiStore.setState({ helpPanelOpen: true });
    render(<HelpPanel />);
    expect(screen.getByText("Starting help assistant...")).toBeInTheDocument();
  });

  it("shows error state with retry button when there is an error", () => {
    useUiStore.setState({
      helpPanelOpen: true,
      helpError: "Something went wrong",
    });
    render(<HelpPanel />);
    expect(screen.getByText("Failed to start help assistant.")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows welcome view when session is ready and no conversation", () => {
    useUiStore.setState({
      helpPanelOpen: true,
      helpSessionId: "help-1",
      helpSessionReady: true,
      helpShowWelcome: true,
    });
    render(<HelpPanel />);
    expect(screen.getByTestId("help-welcome")).toBeInTheDocument();
  });

  it("shows chat and input when session is ready and has conversation", () => {
    useUiStore.setState({
      helpPanelOpen: true,
      helpSessionId: "help-1",
      helpSessionReady: true,
      helpShowWelcome: false,
    });
    useSessionStore.setState({
      sessionMessages: new Map([["help-1", [
        { id: "m1", role: "user", content: "hidden", timestamp: "2024-01-01T00:00:00Z", activityIds: [], isStreaming: false },
        { id: "m2", role: "assistant", content: "hidden", timestamp: "2024-01-01T00:00:01Z", activityIds: [], isStreaming: false },
        { id: "m3", role: "user", content: "visible", timestamp: "2024-01-01T00:00:02Z", activityIds: [], isStreaming: false },
      ]]]),
    });
    render(<HelpPanel />);
    expect(screen.getByTestId("help-chat")).toBeInTheDocument();
    expect(screen.getByTestId("help-input")).toBeInTheDocument();
  });

  it("closes panel when X button is clicked", () => {
    useUiStore.setState({ helpPanelOpen: true });
    render(<HelpPanel />);
    // Find the close button (the X icon)
    const buttons = screen.getAllByRole("button");
    // The last button in the header area is the close button
    const closeBtn = buttons.find((b) => !b.textContent);
    if (closeBtn) fireEvent.click(closeBtn);
    expect(useUiStore.getState().helpPanelOpen).toBe(false);
  });

  it("sends suggestion when a suggestion is clicked", () => {
    useUiStore.setState({
      helpPanelOpen: true,
      helpSessionId: "help-1",
      helpSessionReady: true,
      helpShowWelcome: true,
    });
    render(<HelpPanel />);
    fireEvent.click(screen.getByText("Suggestion"));
    expect(mockSendHelpMessage).toHaveBeenCalledWith("test suggestion");
  });
});
