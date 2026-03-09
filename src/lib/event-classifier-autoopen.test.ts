import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleActivityEvent } from "./event-classifier";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useFileViewerStore } from "../stores/fileViewerStore";
import { useUiStore } from "../stores/uiStore";

const SESSION_ID = "s1";

// Mock the dynamic import of tauri-commands used inside event-classifier
vi.mock("./tauri-commands", () => ({
  readFileContent: vi.fn(() => Promise.resolve("file content here")),
  respondToApproval: vi.fn(() => Promise.resolve()),
}));

function resetStores(): void {
  const session = {
    id: SESSION_ID,
    name: "Test",
    project_path: "/tmp",
    status: "connected" as const,
    created_at: "",
    model: null,
    icon_index: 0,
  };

  useSessionStore.setState({
    sessions: new Map([[SESSION_ID, session]]),
    activeSessionId: SESSION_ID,
    sessionMessages: new Map([[SESSION_ID, []]]),
    sessionStreaming: new Map([[
      SESSION_ID,
      { isStreaming: true, streamingContent: "", currentMessageId: "msg-1" },
    ]]),
    sessionContext: new Map([[SESSION_ID, { used: 0, max: 200000 }]]),
    tabOrder: [SESSION_ID],
  });

  useActivityStore.setState({
    sessionEntries: new Map([[SESSION_ID, []]]),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
    alwaysAllowedTools: new Set(),
  });

  useFileViewerStore.setState({
    openFiles: [],
    activeFilePath: null,
    editedContents: new Map(),
    dirtyFiles: new Set(),
  });

  useUiStore.setState({
    sidebarWidth: 220,
    rightPanelWidth: 360,
    rightTab: "activity",
    showApprovalModal: false,
    showSettingsModal: false,
    showProjectPicker: false,
  });
}

describe("event-classifier: auto-open on Write/Edit", () => {
  beforeEach(resetStores);

  it("tool_use_start for Write creates activity entry with running status", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t1",
      tool_name: "Write",
      tool_input: { file_path: "/src/main.rs", content: "fn main() {}" },
    });

    const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("Write");
    expect(entries[0].status).toBe("running");
    expect(entries[0].toolInput.file_path).toBe("/src/main.rs");
  });

  it("tool_result for Write triggers auto-open (async)", async () => {
    // Start the Write tool
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t1",
      tool_name: "Write",
      tool_input: { file_path: "/src/app.tsx" },
    });

    // Complete it successfully
    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t1",
      content: "File written successfully",
      is_error: false,
    });

    // The auto-open happens via dynamic import + async, so flush microtasks
    await vi.dynamicImportSettled();
    // Give a tick for the async chain
    await new Promise((r) => setTimeout(r, 50));

    // The auto-open is async (dynamic import + readFileContent), entry should be marked done
    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("done");
    expect(entry.result).toBe("File written successfully");
  });

  it("tool_result for Edit triggers auto-open attempt", async () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t2",
      tool_name: "Edit",
      tool_input: { file_path: "/src/lib.ts" },
    });

    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t2",
      content: "Edit applied",
      is_error: false,
    });

    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("done");
    expect(entry.toolName).toBe("Edit");
  });

  it("tool_result with error does NOT trigger auto-open", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t3",
      tool_name: "Write",
      tool_input: { file_path: "/nonexistent/file.rs" },
    });

    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t3",
      content: "Permission denied",
      is_error: true,
    });

    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("error");
    expect(entry.isError).toBe(true);
    // File viewer should NOT have been triggered
    // (auto-open only happens when !event.is_error)
  });

  it("tool_result for Read does NOT trigger auto-open", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t4",
      tool_name: "Read",
      tool_input: { file_path: "/src/main.rs" },
    });

    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t4",
      content: "fn main() {}",
      is_error: false,
    });

    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("done");
    // Read should not trigger file viewer auto-open
  });

  it("tool_result for Bash does NOT trigger auto-open", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t5",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });

    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t5",
      content: "total 24\ndrwxr-xr-x...",
      is_error: false,
    });

    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("done");
  });

  it("Write without file_path does NOT trigger auto-open", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t6",
      tool_name: "Write",
      tool_input: {}, // no file_path
    });

    handleActivityEvent(SESSION_ID, {
      type: "tool_result",
      session_id: SESSION_ID,
      tool_use_id: "t6",
      content: "Done",
      is_error: false,
    });

    const entry = useActivityStore.getState().getActiveEntries(SESSION_ID)[0];
    expect(entry.status).toBe("done");
  });

  it("multiple tool_use_start creates distinct entries", () => {
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t1",
      tool_name: "Read",
      tool_input: { file_path: "/a.ts" },
    });
    handleActivityEvent(SESSION_ID, {
      type: "tool_use_start",
      session_id: SESSION_ID,
      tool_use_id: "t2",
      tool_name: "Write",
      tool_input: { file_path: "/b.ts" },
    });

    const entries = useActivityStore.getState().getActiveEntries(SESSION_ID);
    expect(entries).toHaveLength(2);
    expect(entries[0].toolUseId).toBe("t1");
    expect(entries[1].toolUseId).toBe("t2");
  });
});
