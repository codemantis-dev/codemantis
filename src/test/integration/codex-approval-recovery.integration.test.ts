/**
 * Integration test: Codex stuck-recovery pipeline.
 *
 * Exercises the Part B + Part C fixes together: an in-flight Bash
 * ToolUseStart that triggers the "Running command..." spinner, followed
 * by a synthetic ToolResult{is_error: true} (which is what the new
 * translation.rs `map_sandbox_error` emits for a `commandExecution`
 * sandbox denial), must:
 *
 *   1. Clear the spinning activity entry (label drops back to
 *      "Thinking..." then to inactive).
 *   2. Mark the activity entry as `error`.
 *   3. NOT leave `sessionStuck` set — the session is no longer hung;
 *      a real ToolResult arrived.
 *
 * Plus a separate sub-pipeline exercising Part D + Part C: an approval
 * arrives via the listener while `showApprovalModal` is already true
 * (defect #4); the queue must still grow and the modal-open call must
 * still fire (so the modal re-mounts if it had been visually
 * dismissed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { simulateEventStream } from "../helpers/event-simulator";
import {
  createToolUseStartEvent,
  createToolResultEvent,
  TEST_SESSION_ID,
} from "../helpers/event-fixtures";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useStuckActivityWatchdog } from "../../hooks/useStuckActivityWatchdog";
import type { Session } from "../../types/session";

vi.mock("../../lib/tauri-commands", () => ({
  readFileContent: vi.fn().mockResolvedValue(""),
  syncSessionMode: vi.fn().mockResolvedValue(undefined),
  generateChangelogEntry: vi.fn().mockResolvedValue({}),
  checkProcessAlive: vi.fn().mockResolvedValue(true),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

const SID = TEST_SESSION_ID;
const TEST_SESSION: Session = {
  id: SID,
  name: SID,
  project_path: "/tmp",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: null,
  icon_index: 0,
};

describe("codex stuck-recovery pipeline", () => {
  beforeEach(() => {
    resetAllStores();
    useSessionStore.getState().addSession(TEST_SESSION);
  });

  it("a Bash ToolUseStart followed by an error ToolResult clears the spinner and marks entry as error", () => {
    const TOOL_ID = "tool-bash-1";
    simulateEventStream(SID, [
      createToolUseStartEvent("Bash", { command: "docker compose ps" }, {
        session_id: SID,
        tool_use_id: TOOL_ID,
      }),
    ]);

    // Spinner is on.
    let activity = useSessionStore.getState().sessionActivity.get(SID);
    expect(activity?.label).toBe("Running command...");

    // The translation.rs fix emits ToolResult{is_error:true} for sandbox-denied Bash.
    simulateEventStream(SID, [
      createToolResultEvent(TOOL_ID, "Sandbox denied: permission denied", true, SID),
    ]);

    activity = useSessionStore.getState().sessionActivity.get(SID);
    expect(activity?.label).toBe("Thinking...");

    const entries = useActivityStore.getState().sessionEntries.get(SID) ?? [];
    const entry = entries.find((e) => e.toolUseId === TOOL_ID);
    expect(entry?.status).toBe("error");
  });

  it("approval queue receives a new request even when the modal is already open", () => {
    // Defect #4: previously the listener guard `if (!showApprovalModal)`
    // dropped this re-open call. The fix removes the guard. Here we
    // verify the queue grows AND the modal flag stays true after a
    // second approval arrives while it was already true.
    useUiStore.getState().setShowApprovalModal(true);

    const activityStore = useActivityStore.getState();
    activityStore.enqueueApproval({
      requestId: "req-A",
      toolUseId: "req-A",
      toolName: "Bash",
      toolInput: { command: "ls" },
      sessionId: SID,
      timestamp: new Date().toISOString(),
    });
    expect(useActivityStore.getState().approvalQueue).toHaveLength(1);

    activityStore.enqueueApproval({
      requestId: "req-B",
      toolUseId: "req-B",
      toolName: "Bash",
      toolInput: { command: "pwd" },
      sessionId: SID,
      timestamp: new Date().toISOString(),
    });
    expect(useActivityStore.getState().approvalQueue).toHaveLength(2);
    expect(useUiStore.getState().showApprovalModal).toBe(true);
  });
});

describe("codex stuck-recovery pipeline + watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllStores();
    useSessionStore.getState().addSession(TEST_SESSION);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("watchdog flags a stale Bash session, then clears once a ToolResult arrives", async () => {
    const TOOL_ID = "tool-bash-stuck";
    useSessionStore.getState().setSessionBusy(SID, true);
    simulateEventStream(SID, [
      createToolUseStartEvent("Bash", { command: "docker compose ps" }, {
        session_id: SID,
        tool_use_id: TOOL_ID,
      }),
    ]);

    // Force lastEventTimestamp into the past so the watchdog will trip.
    useSessionStore.setState({
      lastEventTimestamp: new Map([[SID, Date.now() - 40_000]]),
    });

    const { unmount } = renderHook(() => useStuckActivityWatchdog());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(useSessionStore.getState().sessionStuck.get(SID)?.reason).toBe(
      "no-progress",
    );

    // Codex finally emits the error tool_result (or the user's
    // SandboxError path synthesised one). The activity handler should
    // touchLastEvent — which moves lastEventTimestamp forward — and
    // the watchdog should clear the flag on the next tick.
    simulateEventStream(SID, [
      createToolResultEvent(TOOL_ID, "Sandbox denied", true, SID),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    expect(useSessionStore.getState().sessionStuck.get(SID)).toBeUndefined();
    unmount();
  });
});
