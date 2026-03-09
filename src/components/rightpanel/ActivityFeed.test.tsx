import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ActivityFeed from "./ActivityFeed";
import { useActivityStore } from "../../stores/activityStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { ActivityEntry } from "../../types/activity";

const SESSION_ID = "s1";

function setEntries(entries: ActivityEntry[]): void {
  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, { id: SESSION_ID, name: "Test", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }]]),
    activeSessionId: SESSION_ID,
    activeProjectPath: "/tmp",
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([[SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION_ID],
  });
  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, entries]]),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
  });
}

describe("ActivityFeed", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map(),
      activeSessionId: null,
      sessionMessages: new Map(),
      sessionStreaming: new Map(),
      sessionContext: new Map(),
      tabOrder: [],
    });
    useActivityStore.setState({
      sessionEntries: new Map(),
      approvalQueue: [],
      approvalSeenIds: new Set(),
      currentApprovalIndex: 0,
    });
  });

  it("shows empty state when no entries", () => {
    render(<ActivityFeed />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders activity entries with tool names", () => {
    setEntries([
      { id: "a1", toolUseId: "t1", toolName: "Read", toolInput: { file_path: "src/main.rs" }, status: "done", timestamp: "2026-01-01T12:00:00Z", messageId: "m1", isError: false, result: "186 lines" },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
  });

  it("shows tool badge for each entry type", () => {
    setEntries([
      { id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "2026-01-01T12:00:00Z", messageId: "m1", isError: false },
      { id: "a2", toolUseId: "t2", toolName: "Write", toolInput: { file_path: "new.ts" }, status: "done", timestamp: "2026-01-01T12:00:01Z", messageId: "m1", isError: false },
      { id: "a3", toolUseId: "t3", toolName: "Edit", toolInput: { file_path: "old.ts" }, status: "done", timestamp: "2026-01-01T12:00:02Z", messageId: "m1", isError: false },
      { id: "a4", toolUseId: "t4", toolName: "Bash", toolInput: { command: "npm test" }, status: "running", timestamp: "2026-01-01T12:00:03Z", messageId: "m1", isError: false },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("RE")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
    expect(screen.getByText("ED")).toBeInTheDocument();
    expect(screen.getByText("BA")).toBeInTheDocument();
  });

  it("shows error indicator for failed tools", () => {
    setEntries([
      { id: "a1", toolUseId: "t1", toolName: "Bash", toolInput: { command: "bad-command" }, status: "error", timestamp: "2026-01-01T12:00:00Z", messageId: "m1", isError: true, result: "command not found" },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText(/command not found/)).toBeInTheDocument();
  });

  it("shows result text for completed tools", () => {
    setEntries([
      { id: "a1", toolUseId: "t1", toolName: "Glob", toolInput: { pattern: "**/*.ts" }, status: "done", timestamp: "2026-01-01T12:00:00Z", messageId: "m1", isError: false, result: "Found 12 files" },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("Found 12 files")).toBeInTheDocument();
  });

  it("displays tool input details", () => {
    setEntries([
      { id: "a1", toolUseId: "t1", toolName: "Bash", toolInput: { command: "npm install" }, status: "running", timestamp: "2026-01-01T12:00:00Z", messageId: "m1", isError: false },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("npm install")).toBeInTheDocument();
  });
});
