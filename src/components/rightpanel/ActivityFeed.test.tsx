import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActivityFeed from "./ActivityFeed";
import { useActivityStore } from "../../stores/activityStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import type { ActivityEntry } from "../../types/activity";

const SESSION_ID = "s1";
const SESSION_ID_2 = "s2";

function makeEntry(overrides: Partial<ActivityEntry> & { id: string; toolName: string }): ActivityEntry {
  return {
    toolUseId: overrides.id,
    toolInput: {},
    status: "done",
    timestamp: "2026-01-01T12:00:00Z",
    messageId: "m1",
    isError: false,
    ...overrides,
  };
}

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

function setMultiSessionEntries(
  s1Entries: ActivityEntry[],
  s2Entries: ActivityEntry[],
): void {
  useSessionStore.setState({
    sessions: new Map([
      [SESSION_ID, { id: SESSION_ID, name: "Session 1", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
      [SESSION_ID_2, { id: SESSION_ID_2, name: "Session 2", project_path: "/tmp", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
    ]),
    activeSessionId: SESSION_ID,
    activeProjectPath: "/tmp",
    sessionMessages: new Map([[SESSION_ID, []], [SESSION_ID_2, []]]),
    sessionStreaming: new Map([
      [SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }],
      [SESSION_ID_2, { isStreaming: false, streamingContent: "", currentMessageId: null }],
    ]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }], [SESSION_ID_2, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION_ID, SESSION_ID_2],
  });
  useActivityStore.setState({
    sessionEntries: new Map([
      [SESSION_ID, s1Entries],
      [SESSION_ID_2, s2Entries],
    ]),
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
    useUiStore.setState({ activityFeedScope: "session" });
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

  describe("session isolation", () => {
    it("shows only active session entries in session scope (default)", () => {
      setMultiSessionEntries(
        [makeEntry({ id: "a1", toolName: "Read", toolInput: { file_path: "s1-file.ts" }, timestamp: "2026-01-01T12:00:00Z" })],
        [makeEntry({ id: "b1", toolName: "Write", toolInput: { file_path: "s2-file.ts" }, timestamp: "2026-01-01T12:00:01Z" })],
      );
      render(<ActivityFeed />);
      expect(screen.getByText("s1-file.ts")).toBeInTheDocument();
      expect(screen.queryByText("s2-file.ts")).not.toBeInTheDocument();
    });

    it("shows all project entries in project scope", () => {
      useUiStore.setState({ activityFeedScope: "project" });
      setMultiSessionEntries(
        [makeEntry({ id: "a1", toolName: "Read", toolInput: { file_path: "s1-file.ts" }, timestamp: "2026-01-01T12:00:00Z" })],
        [makeEntry({ id: "b1", toolName: "Write", toolInput: { file_path: "s2-file.ts" }, timestamp: "2026-01-01T12:00:01Z" })],
      );
      render(<ActivityFeed />);
      expect(screen.getByText("s1-file.ts")).toBeInTheDocument();
      expect(screen.getByText("s2-file.ts")).toBeInTheDocument();
    });

    it("toggles between session and project scope", async () => {
      const user = userEvent.setup();
      setMultiSessionEntries(
        [makeEntry({ id: "a1", toolName: "Read", toolInput: { file_path: "s1-file.ts" }, timestamp: "2026-01-01T12:00:00Z" })],
        [makeEntry({ id: "b1", toolName: "Write", toolInput: { file_path: "s2-file.ts" }, timestamp: "2026-01-01T12:00:01Z" })],
      );
      render(<ActivityFeed />);

      // Default: session scope — only s1 visible
      expect(screen.getByText("s1-file.ts")).toBeInTheDocument();
      expect(screen.queryByText("s2-file.ts")).not.toBeInTheDocument();
      expect(screen.getByText("Session")).toBeInTheDocument();

      // Toggle to project scope
      await user.click(screen.getByText("Session"));
      expect(screen.getByText("s1-file.ts")).toBeInTheDocument();
      expect(screen.getByText("s2-file.ts")).toBeInTheDocument();
      expect(screen.getByText("Project")).toBeInTheDocument();

      // Toggle back to session scope
      await user.click(screen.getByText("Project"));
      expect(screen.getByText("s1-file.ts")).toBeInTheDocument();
      expect(screen.queryByText("s2-file.ts")).not.toBeInTheDocument();
    });
  });

  it("renders activity entries for session with correct tool badges", () => {
    setEntries([
      makeEntry({ id: "a1", toolName: "Read", toolInput: { file_path: "config.json" }, timestamp: "2026-01-01T12:00:00Z" }),
      makeEntry({ id: "a2", toolName: "Bash", toolInput: { command: "ls -la" }, timestamp: "2026-01-01T12:00:01Z" }),
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("config.json")).toBeInTheDocument();
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("shows error status indicator for failed tools", () => {
    setEntries([
      makeEntry({
        id: "a1",
        toolName: "Write",
        toolInput: { file_path: "readonly.ts" },
        status: "error",
        isError: true,
        result: "Permission denied: readonly.ts",
        timestamp: "2026-01-01T12:00:00Z",
      }),
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("Write")).toBeInTheDocument();
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument();
  });

  it("handles empty entry list without crashing", () => {
    setEntries([]);
    render(<ActivityFeed />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders multiple entries in chronological order", () => {
    setEntries([
      makeEntry({ id: "a1", toolName: "Read", toolInput: { file_path: "first.ts" }, timestamp: "2026-01-01T12:00:00Z" }),
      makeEntry({ id: "a2", toolName: "Edit", toolInput: { file_path: "second.ts" }, timestamp: "2026-01-01T12:00:01Z" }),
      makeEntry({ id: "a3", toolName: "Bash", toolInput: { command: "third-cmd" }, timestamp: "2026-01-01T12:00:02Z" }),
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("first.ts")).toBeInTheDocument();
    expect(screen.getByText("second.ts")).toBeInTheDocument();
    expect(screen.getByText("third-cmd")).toBeInTheDocument();
  });

  describe("cross-project bleed guard", () => {
    it("renders no entries when active session belongs to a different project than activeProjectPath", () => {
      // Scenario: activeSessionId points to a session whose project_path does
      // NOT match activeProjectPath. Would previously display stale entries
      // from that other-project session in the wrong tab.
      useSessionStore.setState({
        sessions: new Map([
          [SESSION_ID, { id: SESSION_ID, name: "Other", project_path: "/projects/other", status: "connected" as const, created_at: "", model: null, icon_index: 0 }],
        ]),
        activeSessionId: SESSION_ID,
        activeProjectPath: "/projects/current",
        sessionMessages: new Map([[SESSION_ID, []]]),
        sessionStreaming: new Map([[SESSION_ID, { isStreaming: false, streamingContent: "", currentMessageId: null }]]),
        sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }]]),
        tabOrder: [SESSION_ID],
      });
      useActivityStore.setState({
        sessionEntries: new Map([
          [SESSION_ID, [
            makeEntry({ id: "foreign", toolName: "Bash", toolInput: { command: "find /projects/other -name '*.py'" }, timestamp: "2026-01-01T12:00:00Z" }),
          ]],
        ]),
        approvalQueue: [],
        approvalSeenIds: new Set(),
        currentApprovalIndex: 0,
      });
      render(<ActivityFeed />);
      expect(screen.getByText("No activity yet")).toBeInTheDocument();
      expect(screen.queryByText(/find \/projects\/other/)).not.toBeInTheDocument();
    });

    it("renders no entries when activeSessionId does not resolve to a known session", () => {
      useSessionStore.setState({
        sessions: new Map(),
        activeSessionId: "ghost-session",
        activeProjectPath: "/projects/current",
        sessionMessages: new Map(),
        sessionStreaming: new Map(),
        sessionContext: new Map(),
        tabOrder: [],
      });
      useActivityStore.setState({
        sessionEntries: new Map([
          ["ghost-session", [
            makeEntry({ id: "orphan", toolName: "Bash", toolInput: { command: "echo hi" }, timestamp: "2026-01-01T12:00:00Z" }),
          ]],
        ]),
        approvalQueue: [],
        approvalSeenIds: new Set(),
        currentApprovalIndex: 0,
      });
      render(<ActivityFeed />);
      expect(screen.getByText("No activity yet")).toBeInTheDocument();
    });
  });
});
