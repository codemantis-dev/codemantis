import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import MessageBubble from "./MessageBubble";
import type { Message } from "../../types/session";

// Mock sub-components to simplify tests
vi.mock("./ActivityChip", () => ({
  default: ({ messageId }: { messageId: string }) => (
    <span data-testid="activity-chip">{messageId}</span>
  ),
}));

vi.mock("./StreamingCursor", () => ({
  default: () => <span data-testid="streaming-cursor" />,
}));

vi.mock("./CodeBlock", () => ({
  default: (props: Record<string, unknown>) => <code>{String(props.children ?? "")}</code>,
}));

vi.mock("./TurnStatsPopover", () => ({
  default: () => <span data-testid="turn-stats-popover" />,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => {} }));

vi.mock("../../lib/format-utils", () => ({
  formatDuration: (ms: number) => `${ms}ms`,
  formatTime: (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "assistant",
    content: "Hello, world!",
    timestamp: "2024-01-01T12:00:00Z",
    activityIds: [],
    isStreaming: false,
    ...overrides,
  };
}

describe("MessageBubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a user message with the content", () => {
    const msg = makeMessage({ role: "user", content: "Hi there" });
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("renders an assistant message with markdown", () => {
    const msg = makeMessage({ role: "assistant", content: "Some **bold** text" });
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("Some **bold** text");
  });

  it("shows StreamingCursor when assistant message is streaming", () => {
    const msg = makeMessage({ isStreaming: true });
    render(<MessageBubble message={msg} streamingContent="partial content" />);
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  it("does not show StreamingCursor when not streaming", () => {
    const msg = makeMessage({ isStreaming: false });
    render(<MessageBubble message={msg} />);
    expect(screen.queryByTestId("streaming-cursor")).not.toBeInTheDocument();
  });

  it("shows Restart button for restartable messages", () => {
    const onRestart = vi.fn();
    const msg = makeMessage({ restartable: true });
    render(<MessageBubble message={msg} onRestart={onRestart} />);
    fireEvent.click(screen.getByText("Restart Session"));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("shows Retry button for retryable messages", () => {
    const onRetry = vi.fn();
    const msg = makeMessage({ retryable: true });
    render(<MessageBubble message={msg} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not show Restart button when onRestart is not provided", () => {
    const msg = makeMessage({ restartable: true });
    render(<MessageBubble message={msg} />);
    expect(screen.queryByText("Restart Session")).not.toBeInTheDocument();
  });

  it("shows timestamp on user messages", () => {
    const msg = makeMessage({ role: "user" });
    render(<MessageBubble message={msg} />);
    // The time format depends on locale; match any HH:MM pattern (AM/PM or 24h)
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it("shows TurnStatsPopover when turnStats are present and not streaming", () => {
    const msg = makeMessage({
      isStreaming: false,
      turnStats: {
        durationMs: 1500,
        costUsd: 0.01,
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("turn-stats-popover")).toBeInTheDocument();
  });

  it("shows ActivityChip for assistant messages", () => {
    const msg = makeMessage({ role: "assistant" });
    render(<MessageBubble message={msg} />);
    expect(screen.getByTestId("activity-chip")).toBeInTheDocument();
  });

  it("copies user message content on copy button click", () => {
    const msg = makeMessage({ role: "user", content: "Copy me" });
    render(<MessageBubble message={msg} />);
    // The copy button is hidden by CSS but exists in the DOM
    const copyBtn = screen.getByTitle("Copy message");
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Copy me");
  });

  it("uses streamingContent when message is streaming", () => {
    const msg = makeMessage({ isStreaming: true, content: "old content" });
    render(<MessageBubble message={msg} streamingContent="new streaming content" />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("new streaming content");
  });

  it("does not render ThinkingContent (moved to Activity tab)", () => {
    const msg = makeMessage({ thinkingContent: "Step 1: analyze the problem." });
    render(<MessageBubble message={msg} />);
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
  });

  it("shows Self-Drive tag on Self-Drive user messages", () => {
    const msg = makeMessage({ role: "user", content: "Build the feature", isSelfDrive: true });
    render(<MessageBubble message={msg} />);
    expect(screen.getByText("Self-Drive")).toBeInTheDocument();
  });

  it("does not show Self-Drive tag on regular user messages", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    render(<MessageBubble message={msg} />);
    expect(screen.queryByText("Self-Drive")).not.toBeInTheDocument();
  });
});
