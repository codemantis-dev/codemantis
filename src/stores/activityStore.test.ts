import { describe, it, expect, beforeEach } from "vitest";
import { useActivityStore } from "./activityStore";

function resetStore(): void {
  useActivityStore.setState({
    sessionEntries: new Map(),
    approvalQueue: [],
    approvalSeenIds: new Set(),
    currentApprovalIndex: 0,
    alwaysAllowedTools: new Map(),
  });
}

describe("activityStore", () => {
  beforeEach(resetStore);

  it("starts empty", () => {
    const state = useActivityStore.getState();
    expect(state.sessionEntries.size).toBe(0);
    expect(state.approvalQueue).toHaveLength(0);
  });

  it("addEntry appends an activity entry for a session", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: { file_path: "src/main.rs" },
      status: "running",
      timestamp: "2026-01-01T00:00:00Z",
      messageId: "m1",
      isError: false,
    });

    const entries = useActivityStore.getState().getActiveEntries("s1");
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("Read");
  });

  it("addEntry preserves existing entries", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().addEntry("s1", {
      id: "a2", toolUseId: "t2", toolName: "Write", toolInput: {}, status: "running", timestamp: "", messageId: "m1", isError: false,
    });
    expect(useActivityStore.getState().getActiveEntries("s1")).toHaveLength(2);
  });

  it("updateEntryStatus updates matching entry", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "running", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().updateEntryStatus("s1", "t1", "done", "186 lines", false);
    const entry = useActivityStore.getState().getActiveEntries("s1")[0];
    expect(entry.status).toBe("done");
    expect(entry.result).toBe("186 lines");
  });

  it("updateEntryStatus marks errors correctly", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Bash", toolInput: {}, status: "running", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().updateEntryStatus("s1", "t1", "error", "command failed", true);
    const entry = useActivityStore.getState().getActiveEntries("s1")[0];
    expect(entry.status).toBe("error");
    expect(entry.isError).toBe(true);
  });

  it("enqueueApproval adds to queue", () => {
    useActivityStore.getState().enqueueApproval({
      requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: { command: "rm -rf /" },
      sessionId: "s1", timestamp: "2026-01-01T00:00:00Z",
    });

    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    expect(useActivityStore.getState().getCurrentApproval()?.toolName).toBe("Bash");
  });

  it("enqueueApproval deduplicates by toolUseId", () => {
    const approval = {
      requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: { command: "npm install" },
      sessionId: "s1", timestamp: "2026-01-01T00:00:00Z",
    };
    useActivityStore.getState().enqueueApproval(approval);
    useActivityStore.getState().enqueueApproval(approval);

    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
  });

  it("dequeueApproval removes from queue and clamps index", () => {
    useActivityStore.getState().enqueueApproval({
      requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: {},
      sessionId: "s1", timestamp: "",
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r2", toolUseId: "t2", toolName: "Write", toolInput: {},
      sessionId: "s1", timestamp: "",
    });

    // Navigate to second item
    useActivityStore.getState().setCurrentApprovalIndex(1);
    expect(useActivityStore.getState().currentApprovalIndex).toBe(1);

    // Remove second item — index should clamp
    useActivityStore.getState().dequeueApproval("t2");
    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    expect(useActivityStore.getState().currentApprovalIndex).toBe(0);
  });

  it("recordApprovalDecision updates matching activity entry", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Bash", toolInput: {}, status: "running", timestamp: "", messageId: "m1", isError: false,
    });

    useActivityStore.getState().recordApprovalDecision("s1", "t1", "approved");
    const entry = useActivityStore.getState().getActiveEntries("s1")[0];
    expect(entry.approvalStatus).toBe("approved");
    expect(entry.approvalTimestamp).toBeDefined();
  });

  it("recordApprovalDecision sets denied status", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Bash", toolInput: {}, status: "running", timestamp: "", messageId: "m1", isError: false,
    });

    useActivityStore.getState().recordApprovalDecision("s1", "t1", "denied");
    const entry = useActivityStore.getState().getActiveEntries("s1")[0];
    expect(entry.approvalStatus).toBe("denied");
  });

  it("getEntriesForMessage filters by messageId", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().addEntry("s1", {
      id: "a2", toolUseId: "t2", toolName: "Write", toolInput: {}, status: "done", timestamp: "", messageId: "m2", isError: false,
    });
    useActivityStore.getState().addEntry("s1", {
      id: "a3", toolUseId: "t3", toolName: "Edit", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });

    expect(useActivityStore.getState().getEntriesForMessage("s1", "m1")).toHaveLength(2);
    expect(useActivityStore.getState().getEntriesForMessage("s1", "m2")).toHaveLength(1);
    expect(useActivityStore.getState().getEntriesForMessage("s1", "m3")).toHaveLength(0);
  });

  it("clearEntries resets session entries and removes session approvals from queue", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r2", toolUseId: "t2", toolName: "Bash", toolInput: {},
      sessionId: "s1", timestamp: "",
    });

    useActivityStore.getState().clearEntries("s1");
    expect(useActivityStore.getState().getActiveEntries("s1")).toEqual([]);
    expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
  });

  it("clearEntries only removes target session from queue", () => {
    useActivityStore.getState().enqueueApproval({
      requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: {},
      sessionId: "s1", timestamp: "",
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r2", toolUseId: "t2", toolName: "Write", toolInput: {},
      sessionId: "s2", timestamp: "",
    });

    useActivityStore.getState().clearEntries("s1");
    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);
    expect(useActivityStore.getState().approvalQueue[0].sessionId).toBe("s2");
  });

  it("multi-session isolation", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().addEntry("s2", {
      id: "a2", toolUseId: "t2", toolName: "Write", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });

    expect(useActivityStore.getState().getActiveEntries("s1")).toHaveLength(1);
    expect(useActivityStore.getState().getActiveEntries("s2")).toHaveLength(1);
    expect(useActivityStore.getState().getActiveEntries("s1")[0].toolName).toBe("Read");
    expect(useActivityStore.getState().getActiveEntries("s2")[0].toolName).toBe("Write");
  });

  it("getApprovalQueueSize returns correct count", () => {
    expect(useActivityStore.getState().getApprovalQueueSize()).toBe(0);

    useActivityStore.getState().enqueueApproval({
      requestId: "r1", toolUseId: "t1", toolName: "Bash", toolInput: {},
      sessionId: "s1", timestamp: "",
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r2", toolUseId: "t2", toolName: "Write", toolInput: {},
      sessionId: "s1", timestamp: "",
    });

    expect(useActivityStore.getState().getApprovalQueueSize()).toBe(2);
  });

  it("addAlwaysAllowedTool makes tool always-allowed for that session", () => {
    useActivityStore.getState().addAlwaysAllowedTool("s1", "Bash");
    expect(useActivityStore.getState().isToolAlwaysAllowed("s1", "Bash")).toBe(true);
    expect(useActivityStore.getState().isToolAlwaysAllowed("s1", "Write")).toBe(false);
  });

  it("alwaysAllowedTools are isolated per session", () => {
    useActivityStore.getState().addAlwaysAllowedTool("s1", "Bash");
    expect(useActivityStore.getState().isToolAlwaysAllowed("s1", "Bash")).toBe(true);
    expect(useActivityStore.getState().isToolAlwaysAllowed("s2", "Bash")).toBe(false);
  });

  it("different sessions can have different always-allowed tools", () => {
    useActivityStore.getState().addAlwaysAllowedTool("s1", "Bash");
    useActivityStore.getState().addAlwaysAllowedTool("s2", "Write");

    expect(useActivityStore.getState().isToolAlwaysAllowed("s1", "Bash")).toBe(true);
    expect(useActivityStore.getState().isToolAlwaysAllowed("s1", "Write")).toBe(false);
    expect(useActivityStore.getState().isToolAlwaysAllowed("s2", "Write")).toBe(true);
    expect(useActivityStore.getState().isToolAlwaysAllowed("s2", "Bash")).toBe(false);
  });

  it("clearAllEntries resets everything", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().enqueueApproval({
      requestId: "r2", toolUseId: "t2", toolName: "Bash", toolInput: {},
      sessionId: "s1", timestamp: "",
    });

    useActivityStore.getState().clearAllEntries();
    expect(useActivityStore.getState().sessionEntries.size).toBe(0);
    expect(useActivityStore.getState().approvalQueue).toHaveLength(0);
    expect(useActivityStore.getState().approvalSeenIds.size).toBe(0);
    expect(useActivityStore.getState().currentApprovalIndex).toBe(0);
  });
});
