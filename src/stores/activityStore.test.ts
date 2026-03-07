import { describe, it, expect, beforeEach } from "vitest";
import { useActivityStore } from "./activityStore";

describe("activityStore", () => {
  beforeEach(() => {
    useActivityStore.setState({
      entries: [],
      pendingApproval: null,
    });
  });

  it("starts empty", () => {
    const state = useActivityStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.pendingApproval).toBeNull();
  });

  it("addEntry appends an activity entry", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: { file_path: "src/main.rs" },
      status: "running",
      timestamp: "2026-01-01T00:00:00Z",
      messageId: "m1",
      isError: false,
    });

    const entries = useActivityStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("Read");
    expect(entries[0].status).toBe("running");
  });

  it("addEntry preserves existing entries", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: {},
      status: "done",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });
    useActivityStore.getState().addEntry({
      id: "a2",
      toolUseId: "t2",
      toolName: "Write",
      toolInput: {},
      status: "running",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });

    expect(useActivityStore.getState().entries).toHaveLength(2);
  });

  it("updateEntryStatus updates matching entry", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: {},
      status: "running",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });

    useActivityStore
      .getState()
      .updateEntryStatus("t1", "done", "186 lines", false);

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe("done");
    expect(entry.result).toBe("186 lines");
    expect(entry.isError).toBe(false);
  });

  it("updateEntryStatus marks errors correctly", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Bash",
      toolInput: {},
      status: "running",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });

    useActivityStore
      .getState()
      .updateEntryStatus("t1", "error", "command failed", true);

    const entry = useActivityStore.getState().entries[0];
    expect(entry.status).toBe("error");
    expect(entry.isError).toBe(true);
    expect(entry.result).toBe("command failed");
  });

  it("updateEntryStatus does not affect other entries", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: {},
      status: "running",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });
    useActivityStore.getState().addEntry({
      id: "a2",
      toolUseId: "t2",
      toolName: "Write",
      toolInput: {},
      status: "running",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });

    useActivityStore.getState().updateEntryStatus("t1", "done");

    expect(useActivityStore.getState().entries[0].status).toBe("done");
    expect(useActivityStore.getState().entries[1].status).toBe("running");
  });

  it("setPendingApproval sets and clears approval", () => {
    const approval = {
      toolUseId: "t1",
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
    };
    useActivityStore.getState().setPendingApproval(approval);
    expect(useActivityStore.getState().pendingApproval).toEqual(approval);

    useActivityStore.getState().setPendingApproval(null);
    expect(useActivityStore.getState().pendingApproval).toBeNull();
  });

  it("getEntriesForMessage filters by messageId", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: {},
      status: "done",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });
    useActivityStore.getState().addEntry({
      id: "a2",
      toolUseId: "t2",
      toolName: "Write",
      toolInput: {},
      status: "done",
      timestamp: "",
      messageId: "m2",
      isError: false,
    });
    useActivityStore.getState().addEntry({
      id: "a3",
      toolUseId: "t3",
      toolName: "Edit",
      toolInput: {},
      status: "done",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });

    const m1Entries = useActivityStore.getState().getEntriesForMessage("m1");
    expect(m1Entries).toHaveLength(2);
    expect(m1Entries[0].toolName).toBe("Read");
    expect(m1Entries[1].toolName).toBe("Edit");

    const m2Entries = useActivityStore.getState().getEntriesForMessage("m2");
    expect(m2Entries).toHaveLength(1);

    const m3Entries = useActivityStore.getState().getEntriesForMessage("m3");
    expect(m3Entries).toHaveLength(0);
  });

  it("clearEntries resets everything", () => {
    useActivityStore.getState().addEntry({
      id: "a1",
      toolUseId: "t1",
      toolName: "Read",
      toolInput: {},
      status: "done",
      timestamp: "",
      messageId: "m1",
      isError: false,
    });
    useActivityStore.getState().setPendingApproval({
      toolUseId: "t2",
      toolName: "Bash",
      toolInput: {},
    });

    useActivityStore.getState().clearEntries();

    expect(useActivityStore.getState().entries).toEqual([]);
    expect(useActivityStore.getState().pendingApproval).toBeNull();
  });
});
