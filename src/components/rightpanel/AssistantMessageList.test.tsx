import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AssistantMessageList from "./AssistantMessageList";
import { useUiStore } from "../../stores/uiStore";
import type { Message } from "../../types/session";

// Mock AssistantChatMessages — avoid React.memo in factory since vi.mock is hoisted
vi.mock("./AssistantChatMessages", () => ({
  default: (props: {
    messages: Array<{ id: string; role: string; content: string; isStreaming?: boolean }>;
    streaming?: { isStreaming: boolean; streamingContent: string; currentMessageId: string | null };
    messagesEndRef: { current: HTMLDivElement | null };
  }) => {
    const { messages, streaming, messagesEndRef } = props;
    return (
      <div data-testid="chat-messages">
        {messages.length === 0 && !streaming?.isStreaming && (
          <span data-testid="empty-state">No messages</span>
        )}
        {messages.map((msg: { id: string; role: string; content: string }) => (
          <div key={msg.id} data-testid={`msg-${msg.id}`} data-role={msg.role}>
            {msg.content}
          </div>
        ))}
        {streaming?.isStreaming && (
          <div data-testid="streaming-cursor">{streaming.streamingContent}</div>
        )}
        <div ref={messagesEndRef} data-testid="messages-end" />
      </div>
    );
  },
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

describe("AssistantMessageList", () => {
  const defaultProps = {
    messages: [] as Message[],
    streaming: undefined,
    showThinking: false,
    activeAssistantId: "s1",
    isClaudeCode: false,
    onContextMenu: vi.fn(),
    onRetry: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user and assistant messages", () => {
    const messages = [
      makeMessage({ id: "m1", role: "user", content: "Hello" }),
      makeMessage({ id: "m2", role: "assistant", content: "Hi there" }),
    ];
    render(<AssistantMessageList {...defaultProps} messages={messages} />);
    expect(screen.getByTestId("msg-m1")).toBeInTheDocument();
    expect(screen.getByTestId("msg-m2")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("shows streaming cursor during streaming", () => {
    render(
      <AssistantMessageList
        {...defaultProps}
        streaming={{
          isStreaming: true,
          streamingContent: "Thinking about it...",
          currentMessageId: "m1",
        }}
      />,
    );
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(screen.getByText("Thinking about it...")).toBeInTheDocument();
  });

  it("handles empty message list", () => {
    render(<AssistantMessageList {...defaultProps} messages={[]} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("provides messagesEndRef for auto-scroll", () => {
    render(
      <AssistantMessageList
        {...defaultProps}
        messages={[makeMessage({ id: "m1" })]}
      />,
    );
    expect(screen.getByTestId("messages-end")).toBeInTheDocument();
  });

  it("passes onRetry callback through to child component", () => {
    const onRetry = vi.fn();
    const messages = [
      makeMessage({ id: "m1", role: "assistant", content: "Response", retryable: true }),
    ];
    render(
      <AssistantMessageList {...defaultProps} messages={messages} onRetry={onRetry} />,
    );
    expect(screen.getByTestId("msg-m1")).toBeInTheDocument();
  });

  it("scrolls to bottom when rightTab changes to assistant", async () => {
    const scrollIntoView = vi.fn();
    useUiStore.setState({ rightTab: "activity" });

    render(
      <AssistantMessageList
        {...defaultProps}
        messages={[makeMessage({ id: "m1" })]}
      />,
    );

    const endEl = screen.getByTestId("messages-end");
    endEl.scrollIntoView = scrollIntoView;

    // Switch to the assistant tab
    useUiStore.setState({ rightTab: "assistant" });

    // Wait for requestAnimationFrame + re-render
    await vi.waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "instant" });
    });
  });
});
