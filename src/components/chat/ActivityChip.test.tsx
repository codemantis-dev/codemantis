import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import ActivityChip from "./ActivityChip";
import type { ActivityEntry } from "../../types/activity";

// Mock StatusDot to simplify assertions
vi.mock("../shared/StatusDot", () => ({
  default: ({ color, pulse }: { color: string; pulse: boolean }) => (
    <span data-testid="status-dot" data-color={color} data-pulse={String(pulse)} />
  ),
}));

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "e1",
    toolUseId: "tu1",
    toolName: "Read",
    toolInput: {},
    status: "done",
    timestamp: new Date().toISOString(),
    messageId: "msg-1",
    isError: false,
    ...overrides,
  };
}

describe("ActivityChip", () => {
  beforeEach(() => {
    useSessionStore.setState({ activeSessionId: "s1" });
    useActivityStore.setState({ sessionEntries: new Map() });
  });

  it("renders nothing when there are no matching entries", () => {
    const { container } = render(<ActivityChip messageId="msg-1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a summary of activity counts", () => {
    const entries: ActivityEntry[] = [
      makeEntry({ id: "e1", toolName: "Read", messageId: "msg-1" }),
      makeEntry({ id: "e2", toolName: "Read", messageId: "msg-1" }),
      makeEntry({ id: "e3", toolName: "Edit", messageId: "msg-1" }),
      makeEntry({ id: "e4", toolName: "Bash", messageId: "msg-1" }),
    ];
    useActivityStore.setState({
      sessionEntries: new Map([["s1", entries]]),
    });

    render(<ActivityChip messageId="msg-1" />);

    expect(screen.getByText(/2 reads/)).toBeInTheDocument();
    expect(screen.getByText(/1 edited/)).toBeInTheDocument();
    expect(screen.getByText(/1 commands/)).toBeInTheDocument();
  });

  it("shows green StatusDot when all entries are done", () => {
    useActivityStore.setState({
      sessionEntries: new Map([
        ["s1", [makeEntry({ id: "e1", toolName: "Read", messageId: "msg-1", status: "done" })]],
      ]),
    });

    render(<ActivityChip messageId="msg-1" />);

    const dot = screen.getByTestId("status-dot");
    expect(dot.dataset.color).toBe("green");
    expect(dot.dataset.pulse).toBe("false");
  });

  it("shows yellow pulsing StatusDot when an entry is running", () => {
    useActivityStore.setState({
      sessionEntries: new Map([
        ["s1", [makeEntry({ id: "e1", toolName: "Read", messageId: "msg-1", status: "running" })]],
      ]),
    });

    render(<ActivityChip messageId="msg-1" />);

    const dot = screen.getByTestId("status-dot");
    expect(dot.dataset.color).toBe("yellow");
    expect(dot.dataset.pulse).toBe("true");
  });

  it("uses explicit sessionId prop over activeSessionId", () => {
    const entries: ActivityEntry[] = [
      makeEntry({ id: "e1", toolName: "Write", messageId: "msg-1" }),
    ];
    useActivityStore.setState({
      sessionEntries: new Map([["s2", entries]]),
    });

    render(<ActivityChip messageId="msg-1" sessionId="s2" />);
    expect(screen.getByText(/1 created/)).toBeInTheDocument();
  });

  it("shows arrow text when no explicit sessionId is provided", () => {
    useActivityStore.setState({
      sessionEntries: new Map([
        ["s1", [makeEntry({ id: "e1", toolName: "Read", messageId: "msg-1" })]],
      ]),
    });

    render(<ActivityChip messageId="msg-1" />);
    expect(screen.getByText(/Activity/)).toBeInTheDocument();
  });

  it("hides arrow text when explicit sessionId is provided", () => {
    useActivityStore.setState({
      sessionEntries: new Map([
        ["s1", [makeEntry({ id: "e1", toolName: "Read", messageId: "msg-1" })]],
      ]),
    });

    render(<ActivityChip messageId="msg-1" sessionId="s1" />);
    expect(screen.queryByText(/Activity/)).not.toBeInTheDocument();
  });
});
