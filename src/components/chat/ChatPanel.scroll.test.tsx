import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "./ChatPanel";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session, Message } from "../../types/session";

const SESSION: Session = {
  id: "s1",
  name: "Test",
  project_path: "/tmp",
  status: "connected",
  created_at: "",
  model: null,
  icon_index: 0,
};

function setSessionState(
  session: Session | null,
  messages: Message[] = []
): void {
  if (session) {
    useSessionStore.setState({
      sessions: new Map([[session.id, session]]),
      activeSessionId: session.id,
      sessionMessages: new Map([[session.id, messages]]),
      sessionStreaming: new Map([
        [
          session.id,
          {
            isStreaming: false,
            streamingContent: "",
            currentMessageId: null,
          },
        ],
      ]),
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

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `Message ${i + 1}`,
    timestamp: "",
    activityIds: [],
    isStreaming: false,
  }));
}

describe("ChatPanel — scroll and message rendering", () => {
  beforeEach(() => setSessionState(null));

  it("renders many messages", () => {
    const msgs = makeMessages(20);
    setSessionState(SESSION, msgs);
    render(<ChatPanel />);
    expect(screen.getByText("Message 1")).toBeInTheDocument();
    expect(screen.getByText("Message 20")).toBeInTheDocument();
  });

  it("renders streaming message placeholder", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionMessages: new Map([
        [
          SESSION.id,
          [
            {
              id: "m1",
              role: "assistant",
              content: "",
              timestamp: "",
              activityIds: [],
              isStreaming: true,
            },
          ],
        ],
      ]),
      sessionStreaming: new Map([
        [
          SESSION.id,
          {
            isStreaming: true,
            streamingContent: "Thinking about your question",
            currentMessageId: "m1",
          },
        ],
      ]),
      sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
      tabOrder: [SESSION.id],
    });
    render(<ChatPanel />);
    expect(
      screen.getByText("Thinking about your question")
    ).toBeInTheDocument();
  });

  it("does not show empty state when streaming with no messages", () => {
    useSessionStore.setState({
      sessions: new Map([[SESSION.id, SESSION]]),
      activeSessionId: SESSION.id,
      sessionMessages: new Map([[SESSION.id, []]]),
      sessionStreaming: new Map([
        [
          SESSION.id,
          {
            isStreaming: true,
            streamingContent: "Hello",
            currentMessageId: null,
          },
        ],
      ]),
      sessionContext: new Map([[SESSION.id, { used: 0, max: 200000 }]]),
      tabOrder: [SESSION.id],
    });
    render(<ChatPanel />);
    // The empty state prompt should NOT appear when streaming
    expect(
      screen.queryByText("Send a message to start the conversation")
    ).not.toBeInTheDocument();
  });

  it("separates user and assistant messages visually", () => {
    setSessionState(SESSION, [
      {
        id: "m1",
        role: "user",
        content: "User msg",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
      {
        id: "m2",
        role: "assistant",
        content: "Assistant msg",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
    ]);
    const { container } = render(<ChatPanel />);

    // User messages are right-aligned (justify-end)
    const userWrapper = container.querySelector(".justify-end");
    expect(userWrapper).toBeTruthy();
  });

  it("renders markdown in assistant messages", () => {
    setSessionState(SESSION, [
      {
        id: "m1",
        role: "assistant",
        content: "Here is a `code snippet` and **bold**",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("code snippet")).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders code blocks in assistant messages", () => {
    setSessionState(SESSION, [
      {
        id: "m1",
        role: "assistant",
        content: "```typescript\nconst x = 1;\n```",
        timestamp: "",
        activityIds: [],
        isStreaming: false,
      },
    ]);
    render(<ChatPanel />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("shows welcome state for missing session", () => {
    render(<ChatPanel />);
    expect(screen.getByText("Welcome to ClaudeForge")).toBeInTheDocument();
    expect(
      screen.getByText("Open a project to start a session")
    ).toBeInTheDocument();
  });
});
