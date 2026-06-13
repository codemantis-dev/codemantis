import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session } from "../../types/session";
import type {
  ProcessErrorEvent,
  ProcessExitedEvent,
} from "../../types/claude-events";
import {
  handleProcessError,
  handleProcessExited,
  startStaleDetection,
  stopStaleDetection,
} from "./process";

// Mock tauri-commands (dynamically imported in process.ts for retry logic)
const mockSendMessage = vi.fn<(sessionId: string, message: string) => Promise<void>>(() => Promise.resolve());
vi.mock("../tauri-commands", () => ({
  sendMessage: (sessionId: string, message: string) => mockSendMessage(sessionId, message),
  checkProcessAlive: vi.fn(() => Promise.resolve(true)),
}));

// Mock toastStore so showToast calls don't fail
vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
}));

const SESSION_ID = "test-session";
const NOW = "2026-04-05T12:00:00Z";

const TEST_SESSION: Session = {
  id: SESSION_ID,
  name: "Test Session",
  project_path: "/tmp/test",
  status: "connected",
  created_at: "2026-01-01T00:00:00Z",
  model: "sonnet",
  icon_index: 0,
};

function resetStore(): void {
  useSessionStore.setState({
    sessions: new Map(),
    activeSessionId: null,
    sessionMessages: new Map(),
    sessionStreaming: new Map(),
    sessionContext: new Map(),
    sessionStats: new Map(),
    sessionModes: new Map(),
    sessionBusy: new Map(),
    sessionEffort: new Map(),
    sessionRetry: new Map(),
    lastEventTimestamp: new Map(),
    contextToastFired: new Map(),
    sessionActivity: new Map(),
    sessionCompacting: new Map(),
    pendingRecapPrefix: new Map(),
    codexRecoverAttempted: new Map(),
    busySince: new Map(),
    rateLimitUtilization: new Map(),
    sessionCapabilities: new Map(),
    activeSubAgents: new Map(),
    sessionThinking: new Map(),
    tabOrder: [],
    activeProjectPath: null,
    projectOrder: [],
    projectActiveSession: new Map(),
  });
}

function setupSession(): void {
  useSessionStore.getState().addSession(TEST_SESSION);
}

function getStore(): ReturnType<typeof useSessionStore.getState> {
  return useSessionStore.getState();
}

// ────────────────────────────────────────────────────────
// handleProcessError
// ────────────────────────────────────────────────────────

describe("handleProcessError", () => {
  beforeEach(() => {
    resetStore();
    setupSession();
  });

  it("finalizes streaming and adds translated error message", () => {
    const store = getStore();
    // Put session into streaming state
    store.startStreaming(SESSION_ID, "msg-streaming-1");
    store.appendStreamingContent(SESSION_ID, "partial text");

    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Claude CLI error: Failed to spawn: No such file or directory (os error 2)",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    // Streaming should be finalized
    const streaming = getStore().sessionStreaming.get(SESSION_ID);
    expect(streaming?.isStreaming).toBe(false);

    // An error message should be added
    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const errorMsg = messages.find((m) => m.content.includes("Claude Code not found"));
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.role).toBe("assistant");
    expect(errorMsg?.isStreaming).toBe(false);
    expect(errorMsg?.content).toContain("How to fix:");
  });

  it("clears busy state on error", () => {
    const store = getStore();
    store.setSessionBusy(SESSION_ID, true);
    expect(getStore().sessionBusy.get(SESSION_ID)).toBe(true);

    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Some unexpected error",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    expect(getStore().sessionBusy.get(SESSION_ID)).toBe(false);
  });

  it("clears the compacting flag on error (no stuck 'Compacting' status)", () => {
    // Regression: a Codex turn can die mid-compaction ("remote compact task:
    // stream disconnected before completion"). compacting is otherwise only
    // cleared by compact_complete, which never arrives on failure — so the
    // status bar (where compacting outranks busy/idle) would stick on
    // "Compacting" forever.
    const store = getStore();
    store.setSessionCompacting(SESSION_ID, true);
    store.setSessionBusy(SESSION_ID, true);
    expect(getStore().sessionCompacting.get(SESSION_ID)).toBe(true);

    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Error running remote compact task: stream disconnected before completion: error decoding response body",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    expect(getStore().sessionCompacting.get(SESSION_ID)).toBe(false);
    expect(getStore().sessionBusy.get(SESSION_ID)).toBe(false);
    // And the failure is surfaced with non-looping guidance, not the generic
    // "try again" that perpetuates the compaction loop.
    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages[messages.length - 1].content).toContain("Context compaction failed");
  });

  it("marks the compaction-failure card recoverable (Recover button)", () => {
    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Error running remote compact task: stream disconnected before completion",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const card = messages[messages.length - 1];
    expect(card.content).toContain("Context compaction failed");
    expect(card.recoverable).toBe(true);
  });

  it("does NOT mark non-compaction errors recoverable", () => {
    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Process not running",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const card = messages[messages.length - 1];
    expect(card.recoverable).toBeFalsy();
  });

  it("escalates to fresh-thread when a revive was already attempted", () => {
    // A compaction failure AFTER a revive means the context is genuinely
    // un-compactable → offer "Start fresh thread", not another revive.
    getStore().setCodexRecoverAttempted(SESSION_ID, true);
    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "remote compact task: stream disconnected before completion",
    };

    handleProcessError(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const card = messages[messages.length - 1];
    expect(card.recoverable).toBeFalsy();
    expect(card.freshThreadable).toBe(true);
  });

  it("handles error when session is not streaming", () => {
    // Session is NOT streaming — finalizeStreaming should NOT be called
    const store = getStore();
    const finalizeSpy = vi.spyOn(store, "finalizeStreaming");

    const event: ProcessErrorEvent = {
      type: "process_error",
      session_id: SESSION_ID,
      error: "Process not running",
    };

    handleProcessError(SESSION_ID, event, store, NOW);

    expect(finalizeSpy).not.toHaveBeenCalled();

    // Error message should still be added
    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[messages.length - 1].content).toContain("Session disconnected");

    finalizeSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────
// handleProcessExited
// ────────────────────────────────────────────────────────

describe("handleProcessExited", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    setupSession();
    mockSendMessage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects auth failure from stderr keywords and adds auth message", () => {
    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "Error: authentication token expired",
      elapsed_ms: 2000, // < 5000ms qualifies for auth heuristic
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const authMsg = messages.find((m) => m.content.includes("Authentication failed"));
    expect(authMsg).toBeDefined();
    expect(authMsg?.restartable).toBe(true);
    expect(authMsg?.content).toContain("claude login");
  });

  it("detects rate limit from stderr keywords and sets up retry", () => {
    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "Error: 429 Too Many Requests",
      elapsed_ms: 10000,
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    // Should add a rate limit message
    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const rlMsg = messages.find((m) => m.content.includes("Rate limited"));
    expect(rlMsg).toBeDefined();
    expect(rlMsg?.content).toContain("Retrying in 30s");
    expect(rlMsg?.content).toContain("attempt 1/3");

    // Should set retry state
    const retryState = getStore().sessionRetry.get(SESSION_ID);
    expect(retryState).toBeDefined();
    expect(retryState?.isRetrying).toBe(true);
    expect(retryState?.retryAttempt).toBe(1);
  });

  it("rate limit retry sends last user message after delay", async () => {
    // Add a user message to the session so the retry can find it
    getStore().addMessage(SESSION_ID, {
      id: "msg-user-1",
      role: "user",
      content: "Explain quantum computing",
      timestamp: NOW,
      activityIds: [],
      isStreaming: false,
    });

    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "rate limit exceeded",
      elapsed_ms: 15000,
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    // Timer should be pending (30s for first attempt)
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Advance past the 30s delay
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockSendMessage).toHaveBeenCalledWith(SESSION_ID, "Explain quantum computing");
    // Retry state should be cleared after the timer fires
    const retryState = getStore().sessionRetry.get(SESSION_ID);
    expect(retryState?.isRetrying).toBeFalsy();
  });

  it("rate limit gives up after 3 attempts with restartable message", () => {
    // Pre-set retry state to simulate 2 prior attempts
    getStore().setRetryState(SESSION_ID, {
      isRetrying: true,
      retryAttempt: 2,
      retryAt: null,
      retryTimerId: null,
    });

    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "429 rate_limit",
      elapsed_ms: 10000,
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    const lastMsg = messages[messages.length - 1];

    // On attempt 3, message should be restartable (no more auto-retries)
    expect(lastMsg.content).toContain("attempt 3/3");
    expect(lastMsg.restartable).toBe(true);
  });

  it("recovers stuck busy/streaming state on exit", () => {
    const store = getStore();
    store.setSessionBusy(SESSION_ID, true);
    store.startStreaming(SESSION_ID, "msg-stuck-1");
    store.appendStreamingContent(SESSION_ID, "partial content");

    expect(getStore().sessionBusy.get(SESSION_ID)).toBe(true);
    expect(getStore().sessionStreaming.get(SESSION_ID)?.isStreaming).toBe(true);

    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 0,
      stderr_tail: null,
      elapsed_ms: 5000,
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    // Busy and streaming should be cleared
    expect(getStore().sessionBusy.get(SESSION_ID)).toBe(false);
    expect(getStore().sessionStreaming.get(SESSION_ID)?.isStreaming).toBe(false);
  });

  it("clean exit (code 0) adds no error message", () => {
    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 0,
      stderr_tail: null,
      elapsed_ms: 30000,
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    // No error messages should be added for clean exit
    expect(messages.length).toBe(0);
  });

  it("non-auth non-rate-limit error adds translated error with stderr", () => {
    const event: ProcessExitedEvent = {
      type: "process_exited",
      session_id: SESSION_ID,
      exit_code: 1,
      stderr_tail: "Segmentation fault (core dumped)",
      elapsed_ms: 45000, // > 5000ms so auth heuristic does not trigger
    };

    handleProcessExited(SESSION_ID, event, getStore(), NOW);

    const messages = getStore().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages.length).toBe(1);

    const errorMsg = messages[0];
    expect(errorMsg.role).toBe("assistant");
    expect(errorMsg.isStreaming).toBe(false);
    expect(errorMsg.restartable).toBe(true);
    // Should include the stderr detail block
    expect(errorMsg.content).toContain("Segmentation fault (core dumped)");
    expect(errorMsg.content).toContain("**Details:**");
  });
});

// ────────────────────────────────────────────────────────
// Stale Detection
// ────────────────────────────────────────────────────────

describe("stale detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    setupSession();
  });

  afterEach(() => {
    // Clean up any stale detection timers
    stopStaleDetection(SESSION_ID);
    vi.useRealTimers();
  });

  it("startStaleDetection registers session and stopStaleDetection cleans up", () => {
    // Before start: session should not be tracked
    // Start stale detection
    startStaleDetection(SESSION_ID);

    // The session's lastEventTimestamp should be set (touchLastEvent is called)
    const ts = getStore().lastEventTimestamp.get(SESSION_ID);
    expect(ts).toBeDefined();
    expect(ts).toBeGreaterThan(0);

    // Start a second session to verify the shared timer stays alive
    const SESSION_ID_2 = "test-session-2";
    getStore().addSession({ ...TEST_SESSION, id: SESSION_ID_2 });
    startStaleDetection(SESSION_ID_2);

    // Stop detection for the first session
    stopStaleDetection(SESSION_ID);

    // Stopping the second session should fully clean up
    stopStaleDetection(SESSION_ID_2);

    // After stopping all sessions, the shared timer is cleared internally.
    // We verify by starting fresh — no leftover timers interfere.
    startStaleDetection(SESSION_ID);
    const ts2 = getStore().lastEventTimestamp.get(SESSION_ID);
    expect(ts2).toBeDefined();
    stopStaleDetection(SESSION_ID);
  });
});
