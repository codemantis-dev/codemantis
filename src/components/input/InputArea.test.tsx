import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InputArea from "./InputArea";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";

const SESSION: Session = {
  id: "s1", name: "Test", project_path: "/tmp", status: "connected", created_at: "", model: null, icon_index: 0,
};

function setSessionState(session: Session | null): void {
  if (session) {
    useSessionStore.setState({
      sessions: new Map([[session.id, session]]),
      activeSessionId: session.id,
      sessionMessages: new Map([[session.id, []]]),
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

describe("InputArea", () => {
  beforeEach(() => setSessionState(null));

  it("renders disabled state when no session", () => {
    render(<InputArea />);
    const textarea = screen.getByPlaceholderText("Open a project to start...");
    expect(textarea).toBeDisabled();
  });

  it("renders enabled state when session active", () => {
    setSessionState(SESSION);
    render(<InputArea />);
    const textarea = screen.getByPlaceholderText(/Ask Claude anything/);
    expect(textarea).not.toBeDisabled();
  });

  it("renders action buttons", () => {
    render(<InputArea />);
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("send button shows disabled style with empty input", () => {
    setSessionState(SESSION);
    render(<InputArea />);
    const sendButton = screen.getByText("Send").closest("button");
    expect(sendButton).toBeDisabled();
  });
});
