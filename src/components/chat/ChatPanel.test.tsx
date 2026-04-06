import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "./ChatPanel";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session, Message } from "../../types/session";

const SESSION: Session = {
  id: "s1", name: "Test", project_path: "/tmp", status: "connected", created_at: "", model: null, icon_index: 0,
};

function setSessionState(session: Session | null, messages: Message[] = []): void {
  if (session) {
    useSessionStore.setState({
      sessions: new Map([[session.id, session]]),
      activeSessionId: session.id,
      sessionMessages: new Map([[session.id, messages]]),
      sessionStreaming: new Map([[session.id, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([[session.id, { used: 0, max: 200000 }]]),
      tabOrder: [session.id],
    });
  } else {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: [],
    });
  }
}

describe("ChatPanel", () => {
  beforeEach(() => setSessionState(null));

  it("shows welcome text when no session", () => {
    render(<ChatPanel />);
    expect(screen.getByText("Welcome to CodeMantis")).toBeInTheDocument();
  });

  it("shows empty state prompt when session exists but no messages", () => {
    setSessionState(SESSION);
    render(<ChatPanel />);
    expect(screen.getByText("Send a message to start the conversation")).toBeInTheDocument();
  });

  it("renders user messages", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "Hello Claude", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("Hello Claude")).toBeInTheDocument();
  });

  it("renders assistant messages with markdown", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "assistant", content: "This is **bold** text", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders multiple messages in order", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "First message", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "assistant", content: "Second message", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m3", role: "user", content: "Third message", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
    expect(screen.getByText("Third message")).toBeInTheDocument();
  });

  it("shows 'Previous session' separator between restored and new messages", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "Old user question", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m2", role: "assistant", content: "Old assistant reply", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m3", role: "user", content: "New question after resume", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("Previous session")).toBeInTheDocument();
    expect(screen.getByText("Old user question")).toBeInTheDocument();
    expect(screen.getByText("New question after resume")).toBeInTheDocument();
  });

  it("does not show separator when all messages are restored", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "Restored msg 1", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m2", role: "assistant", content: "Restored msg 2", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
    ]);
    render(<ChatPanel />);
    expect(screen.queryByText("Previous session")).not.toBeInTheDocument();
  });

  it("does not show separator when no messages are restored", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "Normal msg", timestamp: "", activityIds: [], isStreaming: false },
      { id: "m2", role: "assistant", content: "Normal reply", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    expect(screen.queryByText("Previous session")).not.toBeInTheDocument();
  });

  it("shows separator at correct boundary with multiple restored messages", () => {
    setSessionState(SESSION, [
      { id: "m1", role: "user", content: "Restored 1", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m2", role: "assistant", content: "Restored 2", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m3", role: "user", content: "Restored 3", timestamp: "", activityIds: [], isStreaming: false, isRestored: true },
      { id: "m4", role: "assistant", content: "New message", timestamp: "", activityIds: [], isStreaming: false },
    ]);
    render(<ChatPanel />);
    // Only one separator should exist
    const separators = screen.getAllByText("Previous session");
    expect(separators).toHaveLength(1);
  });

  it("shows ThinkingIndicator when busy with no streaming", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionMessages: new Map([[SESSION.id, [
        { id: "m1", role: "user", content: "Do something", timestamp: "", activityIds: [], isStreaming: false },
      ]]]),
      sessionStreaming: new Map([[SESSION.id, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
      sessionBusy: new Map([[SESSION.id, true]]),
      tabOrder: [SESSION.id],
    });
    render(<ChatPanel />);
    // ThinkingIndicator is rendered when isBusy && !isStreaming — it contains a status bar area
    // The ThinkingIndicator's container div should be in the document
    const thinkingContainer = document.querySelector("[class*='shrink-0'][class*='border-t']");
    expect(thinkingContainer).toBeInTheDocument();
  });

  it("renders without crashing when session is not busy", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionMessages: new Map([[SESSION.id, [
        { id: "m1", role: "user", content: "Hello", timestamp: "", activityIds: [], isStreaming: false },
      ]]]),
      sessionStreaming: new Map([[SESSION.id, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
      sessionBusy: new Map([[SESSION.id, false]]),
      tabOrder: [SESSION.id],
    });
    const { container } = render(<ChatPanel />);
    expect(container).toBeTruthy();
  });

  it("shows compacting indicator when session is compacting", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionMessages: new Map([[SESSION.id, []]]),
      sessionStreaming: new Map([[SESSION.id, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
      sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
      sessionBusy: new Map([[SESSION.id, false]]),
      sessionCompacting: new Map([[SESSION.id, true]]),
      tabOrder: [SESSION.id],
    });
    render(<ChatPanel />);
    // SessionStatusBar is always rendered when activeSessionId exists and shows "Compacting" status
    expect(screen.getByText("Compacting")).toBeInTheDocument();
  });

  it("handles empty message array without crashing", () => {
    setSessionState(SESSION, []);
    const { container } = render(<ChatPanel />);
    expect(container).toBeTruthy();
    // Should show the empty state prompt
    expect(screen.getByText("Send a message to start the conversation")).toBeInTheDocument();
    // Should not show any message bubbles
    expect(screen.queryByText("Previous session")).not.toBeInTheDocument();
  });
});
