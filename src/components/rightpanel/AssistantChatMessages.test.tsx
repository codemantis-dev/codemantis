import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AssistantChatMessages from "./AssistantChatMessages";
import type { Message } from "../../types/session";
import React from "react";

// Mock MessageBubble
vi.mock("../chat/MessageBubble", () => ({
  default: ({ message }: { message: Message }) => (
    <div data-testid={`bubble-${message.id}`}>{message.content}</div>
  ),
}));

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    role: "user",
    content: "Hello",
    timestamp: "2026-01-01T00:00:00Z",
    activityIds: [],
    isStreaming: false,
    ...overrides,
  };
}

describe("AssistantChatMessages", () => {
  const defaultProps = {
    messages: [] as Message[],
    streaming: undefined,
    showThinking: false,
    activeAssistantId: "s1",
    isClaudeCode: false,
    onContextMenu: vi.fn(),
    onRetry: vi.fn(),
    messagesEndRef: React.createRef<HTMLDivElement>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no messages and not streaming", () => {
    render(<AssistantChatMessages {...defaultProps} />);
    expect(screen.getByText("Send a message to get started.")).toBeInTheDocument();
  });

  it("shows Claude Code specific empty state text when isClaudeCode is true", () => {
    render(<AssistantChatMessages {...defaultProps} isClaudeCode={true} />);
    expect(
      screen.getByText("Send a message or use / commands to get started.")
    ).toBeInTheDocument();
  });

  it("renders messages when provided", () => {
    const messages = [
      makeMessage({ id: "m1", content: "Hello" }),
      makeMessage({ id: "m2", role: "assistant", content: "Hi there" }),
    ];
    render(<AssistantChatMessages {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("bubble-m1")).toBeInTheDocument();
    expect(screen.getByTestId("bubble-m2")).toBeInTheDocument();
  });

  it("shows thinking indicator when showThinking is true", () => {
    render(<AssistantChatMessages {...defaultProps} showThinking={true} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("triggers context menu on user message right-click", () => {
    const onContextMenu = vi.fn();
    const messages = [makeMessage({ id: "m1", role: "user", content: "Test msg" })];
    render(
      <AssistantChatMessages
        {...defaultProps}
        messages={messages}
        onContextMenu={onContextMenu}
      />
    );
    const wrapper = screen.getByTestId("bubble-m1").parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(onContextMenu).toHaveBeenCalledWith(expect.anything(), "Test msg");
  });

  it("does not trigger context menu on assistant messages", () => {
    const onContextMenu = vi.fn();
    const messages = [makeMessage({ id: "m1", role: "assistant", content: "Reply" })];
    render(
      <AssistantChatMessages
        {...defaultProps}
        messages={messages}
        onContextMenu={onContextMenu}
      />
    );
    const wrapper = screen.getByTestId("bubble-m1").parentElement!;
    fireEvent.contextMenu(wrapper);
    expect(onContextMenu).not.toHaveBeenCalled();
  });
});
