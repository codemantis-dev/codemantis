import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import HelpChat from "./HelpChat";

vi.mock("../chat/StreamingCursor", () => ({
  default: () => <span data-testid="streaming-cursor" />,
}));

vi.mock("../chat/CodeBlock", () => ({
  default: (props: Record<string, unknown>) => <code>{String(props.children ?? "")}</code>,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => {} }));

vi.mock("../../lib/empty-refs", () => ({
  EMPTY_ARRAY: [],
  EMPTY_STREAMING: { isStreaming: false, streamingContent: "", currentMessageId: null },
}));

describe("HelpChat", () => {
  const sessionId = "help-session";

  beforeEach(() => {
    useSessionStore.setState({
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
    });
  });

  it("renders without crashing when no messages exist", () => {
    const { container } = render(<HelpChat sessionId={sessionId} isBusy={false} />);
    expect(container).toBeTruthy();
  });

  it("shows thinking indicator when busy and not streaming", () => {
    render(<HelpChat sessionId={sessionId} isBusy={true} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("does not show thinking indicator when not busy", () => {
    render(<HelpChat sessionId={sessionId} isBusy={false} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("renders visible messages after skipping HIDDEN_PREFIX", () => {
    useSessionStore.setState({
      sessionMessages: new Map([[sessionId, [
        // Hidden: system prompt and ack (first 2)
        { id: "m1", role: "user", content: "System prompt", timestamp: "2024-01-01T00:00:00Z", activityIds: [], isStreaming: false },
        { id: "m2", role: "assistant", content: "Acknowledged", timestamp: "2024-01-01T00:00:01Z", activityIds: [], isStreaming: false },
        // Visible
        { id: "m3", role: "user", content: "How do I use templates?", timestamp: "2024-01-01T00:00:02Z", activityIds: [], isStreaming: false },
        { id: "m4", role: "assistant", content: "You can use templates by...", timestamp: "2024-01-01T00:00:03Z", activityIds: [], isStreaming: false },
      ]]]),
    });

    render(<HelpChat sessionId={sessionId} isBusy={false} />);

    expect(screen.getByText("How do I use templates?")).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toHaveTextContent("You can use templates by...");
    // The hidden messages should not appear
    expect(screen.queryByText("System prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Acknowledged")).not.toBeInTheDocument();
  });

  it("shows streaming cursor for streaming assistant messages", () => {
    useSessionStore.setState({
      sessionMessages: new Map([[sessionId, [
        { id: "m1", role: "user", content: "hidden1", timestamp: "2024-01-01T00:00:00Z", activityIds: [], isStreaming: false },
        { id: "m2", role: "assistant", content: "hidden2", timestamp: "2024-01-01T00:00:01Z", activityIds: [], isStreaming: false },
        { id: "m3", role: "assistant", content: "", timestamp: "2024-01-01T00:00:02Z", activityIds: [], isStreaming: true },
      ]]]),
      sessionStreaming: new Map([[sessionId, {
        isStreaming: true,
        streamingContent: "Partial response...",
        currentMessageId: "m3",
      }]]),
    });

    render(<HelpChat sessionId={sessionId} isBusy={true} />);
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  it("does not show thinking indicator when busy AND streaming", () => {
    useSessionStore.setState({
      sessionMessages: new Map([[sessionId, [
        { id: "m1", role: "user", content: "hidden1", timestamp: "2024-01-01T00:00:00Z", activityIds: [], isStreaming: false },
        { id: "m2", role: "assistant", content: "hidden2", timestamp: "2024-01-01T00:00:01Z", activityIds: [], isStreaming: false },
      ]]]),
      sessionStreaming: new Map([[sessionId, {
        isStreaming: true,
        streamingContent: "text",
        currentMessageId: "m2",
      }]]),
    });

    render(<HelpChat sessionId={sessionId} isBusy={true} />);
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });
});
