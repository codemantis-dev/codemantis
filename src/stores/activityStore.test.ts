import { describe, it, expect, beforeEach } from "vitest";
import { useActivityStore } from "./activityStore";

function resetStore(): void {
  useActivityStore.setState({
    sessionEntries: new Map(),
    sessionApprovals: new Map(),
    alwaysAllowedTools: new Set(),
  });
}

describe("activityStore", () => {
  beforeEach(resetStore);

  it("starts empty", () => {
    const state = useActivityStore.getState();
    expect(state.sessionEntries.size).toBe(0);
    expect(state.sessionApprovals.size).toBe(0);
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

  it("setPendingApproval sets and clears approval for session", () => {
    const approval = { toolUseId: "t1", toolName: "Bash", toolInput: { command: "rm -rf /" } };
    useActivityStore.getState().setPendingApproval("s1", approval);
    expect(useActivityStore.getState().getActivePendingApproval("s1")).toEqual(approval);

    useActivityStore.getState().setPendingApproval("s1", null);
    expect(useActivityStore.getState().getActivePendingApproval("s1")).toBeNull();
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

  it("clearEntries resets session entries", () => {
    useActivityStore.getState().addEntry("s1", {
      id: "a1", toolUseId: "t1", toolName: "Read", toolInput: {}, status: "done", timestamp: "", messageId: "m1", isError: false,
    });
    useActivityStore.getState().setPendingApproval("s1", {
      toolUseId: "t2", toolName: "Bash", toolInput: {},
    });

    useActivityStore.getState().clearEntries("s1");
    expect(useActivityStore.getState().getActiveEntries("s1")).toEqual([]);
    expect(useActivityStore.getState().getActivePendingApproval("s1")).toBeNull();
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
});
