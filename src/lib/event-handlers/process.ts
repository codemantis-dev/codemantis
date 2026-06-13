import type {
  ProcessErrorEvent,
  ProcessExitedEvent,
} from "../../types/claude-events";
import { useSessionStore } from "../../stores/sessionStore";
import { showToast } from "../../stores/toastStore";
import { translateError } from "../error-messages";
import { nextMessageId } from "./chat";

// Store state types (derived from Zustand store getState())
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

// Auto-retry budget for transient Codex compaction-stream drops. A dropped
// "remote compact task" stream is usually transient (distinct from a genuinely
// too-large context, which arrives as ContextWindowExceeded), so we re-run the
// turn a few times before surfacing any card — restoring the pre-v1.7.0
// "compaction just recovers" behavior. Short backoff: stream drops recover fast.
const COMPACTION_MAX_RETRIES = 3;
const COMPACTION_RETRY_DELAYS = [3, 8, 15];

/**
 * Schedule an automatic retry of the last turn after a transient compaction
 * failure. Returns true if a retry was scheduled (caller shows no card), false
 * if the budget is spent or there's nothing to retry (caller shows the card).
 */
function tryAutoRetryCompaction(sessionId: string, store: SessionStoreState, now: string): boolean {
  const messages = store.sessionMessages.get(sessionId) ?? [];
  let lastUserPrompt = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserPrompt = messages[i].content;
      break;
    }
  }
  if (!lastUserPrompt) return false; // nothing to re-run → fall through to card

  const attempt = (store.sessionRetry.get(sessionId)?.retryAttempt ?? 0) + 1;
  if (attempt > COMPACTION_MAX_RETRIES) {
    // Budget spent — reset it (so a later manual Retry gets a fresh budget) and
    // let the caller surface the Retry/Recover card.
    store.clearRetry(sessionId);
    return false;
  }

  const delaySec = COMPACTION_RETRY_DELAYS[Math.min(attempt - 1, COMPACTION_RETRY_DELAYS.length - 1)];
  store.addMessage(sessionId, {
    id: nextMessageId(),
    role: "assistant",
    content:
      `**Compaction hiccup.** Codex's compaction stream dropped — retrying automatically ` +
      `in ${delaySec}s (attempt ${attempt}/${COMPACTION_MAX_RETRIES}). Your conversation is intact.`,
    timestamp: now,
    activityIds: [],
    isStreaming: false,
  });
  showToast(`Compaction stream dropped — auto-retrying in ${delaySec}s`, "info", delaySec * 1000);

  const timerId = setTimeout(() => {
    const s = useSessionStore.getState();
    if (!s.sessions.has(sessionId)) return; // session closed mid-wait
    // NOTE: do NOT clearRetry here — the attempt count must persist so a repeat
    // failure escalates. It's cleared on success (handleTurnComplete) or when
    // the budget is spent above.
    import("../tauri-commands").then(({ sendMessage }) => {
      s.setSessionBusy(sessionId, true);
      sendMessage(sessionId, lastUserPrompt).catch((e: unknown) => {
        console.error("Compaction auto-retry failed:", e);
        useSessionStore.getState().setSessionBusy(sessionId, false);
      });
    });
  }, delaySec * 1000);

  store.setRetryState(sessionId, {
    isRetrying: true,
    retryAttempt: attempt,
    retryAt: Date.now() + delaySec * 1000,
    retryTimerId: timerId,
  });
  return true;
}

export function handleProcessError(sessionId: string, event: ProcessErrorEvent, store: SessionStoreState, now: string): void {
  store.setSessionBusy(sessionId, false);
  // A turn can die mid-compaction (e.g. Codex's "remote compact task: stream
  // disconnected before completion"). The compacting flag is otherwise ONLY
  // cleared by a `compact_complete` event, which never arrives on failure —
  // so without this the status bar sticks on "Compacting" forever (it takes
  // priority over busy/idle in SessionStatusBar) even though nothing is
  // running. Always clear it on a terminal error.
  store.setSessionCompacting(sessionId, false);
  const streaming = store.sessionStreaming.get(sessionId);
  if (streaming?.isStreaming) {
    store.finalizeStreaming(sessionId);
  }
  const userError = translateError(event.error);
  // The Codex compaction-failure path (Codex-only). This is the *transient*
  // compaction-stream drop ("remote compact task: stream disconnected") — a
  // genuine out-of-context is a SEPARATE signal (ContextWindowExceeded →
  // RateLimitWarning) and never reaches here. Before v1.7.0 this blip was a
  // plain retryable error and simply re-sending continued the work; v1.7.0
  // reframed it as a terminal "start a new session" dead-end (the regression).
  // Restore the v1.6.0 behavior: AUTO-retry the turn a few times first; only if
  // that's exhausted do we surface a card — retryable (manual re-run) with the
  // non-destructive "Recover session" (revive) escalation, and "Start fresh
  // thread" once a revive has already failed.
  const isCompactionFailure = userError.title === "Context compaction failed";
  if (isCompactionFailure && tryAutoRetryCompaction(sessionId, store, now)) {
    return;
  }

  const errorMsgId = nextMessageId();
  const alreadyRevived = store.codexRecoverAttempted.get(sessionId) ?? false;
  store.addMessage(sessionId, {
    id: errorMsgId,
    role: "assistant",
    content:
      `**${userError.title}**\n\n${userError.message}` +
      (userError.remediation ? `\n\n**How to fix:** ${userError.remediation}` : ""),
    timestamp: now,
    activityIds: [],
    isStreaming: false,
    retryable: isCompactionFailure,
    recoverable: isCompactionFailure && !alreadyRevived,
    freshThreadable: isCompactionFailure && alreadyRevived,
  });
}

export function handleProcessExited(sessionId: string, event: ProcessExitedEvent, store: SessionStoreState, now: string): void {
  // Safety net: if turn_complete already cleared busy/streaming, this is a no-op.
  // Only act if the session is still stuck (e.g., process crashed before emitting result).
  const wasBusy = store.sessionBusy.get(sessionId) ?? false;
  const wasStreaming = store.sessionStreaming.get(sessionId)?.isStreaming ?? false;

  if (wasBusy || wasStreaming) {
    console.warn("[process_exited] Session still busy/streaming — recovering:", sessionId);
    store.setSessionBusy(sessionId, false);
    if (wasStreaming) {
      store.finalizeStreaming(sessionId);
    }
  }
  store.updateSessionStatus(sessionId, "idle");

  // Auth failure heuristic: quick exit + auth keywords in stderr
  const AUTH_KEYWORDS = [
    "auth", "login", "token", "expired", "unauthorized",
    "401", "403", "credential", "sign in", "not logged in",
    "authentication", "unauthenticated",
  ];
  const stderrLower = (event.stderr_tail ?? "").toLowerCase();
  const isAuthFailure =
    event.elapsed_ms < 5000 &&
    event.exit_code !== 0 &&
    AUTH_KEYWORDS.some((kw) => stderrLower.includes(kw));

  // Rate limit detection
  const RATE_LIMIT_KEYWORDS = ["rate limit", "429", "too many requests", "rate_limit"];
  const isRateLimit =
    event.exit_code !== 0 &&
    RATE_LIMIT_KEYWORDS.some((kw) => stderrLower.includes(kw));

  if (isAuthFailure) {
    store.addMessage(sessionId, {
      id: nextMessageId(),
      role: "assistant",
      content:
        "**Authentication failed.** Your Claude session may have expired.\n\n" +
        "To fix this, open a terminal and run:\n\n```\nclaude login\n```\n\n" +
        "Then start a new session in CodeMantis.",
      timestamp: now,
      activityIds: [],
      isStreaming: false,
      restartable: true,
    });
    showToast("Authentication failed — run 'claude login' in a terminal", "error", 12000);
  } else if (isRateLimit) {
    // Auto-retry with exponential backoff
    const retryState = store.sessionRetry.get(sessionId);
    const attempt = (retryState?.retryAttempt ?? 0) + 1;
    const delays = [30, 60, 120];
    const delaySec = delays[Math.min(attempt - 1, delays.length - 1)];

    store.addMessage(sessionId, {
      id: nextMessageId(),
      role: "assistant",
      content:
        `**Rate limited.** Retrying in ${delaySec}s (attempt ${attempt}/3)...\n\n` +
        `The API returned a rate limit error. Auto-retrying with exponential backoff.`,
      timestamp: now,
      activityIds: [],
      isStreaming: false,
      restartable: attempt >= 3,
    });
    showToast(`Rate limited — retrying in ${delaySec}s`, "info", delaySec * 1000);

    if (attempt <= 3) {
      const retryAt = Date.now() + delaySec * 1000;
      const timerId = setTimeout(() => {
        // Re-send the last user message
        const messages = store.sessionMessages.get(sessionId) ?? [];
        let lastUserPrompt = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            lastUserPrompt = messages[i].content;
            break;
          }
        }
        store.clearRetry(sessionId);
        if (lastUserPrompt) {
          import("../tauri-commands").then(({ sendMessage }) => {
            store.setSessionBusy(sessionId, true);
            sendMessage(sessionId, lastUserPrompt).catch((e: unknown) => {
              console.error("Rate limit retry failed:", e);
              store.setSessionBusy(sessionId, false);
            });
          });
        }
      }, delaySec * 1000);

      store.setRetryState(sessionId, {
        isRetrying: true,
        retryAttempt: attempt,
        retryAt,
        retryTimerId: timerId,
      });
    }
  } else if (event.exit_code !== 0) {
    const stderrSummary = event.stderr_tail ?? "";
    const userError = translateError(
      stderrSummary || `Process exited with code ${event.exit_code}`
    );
    const stderrBlock = event.stderr_tail
      ? `\n\n**Details:**\n\`\`\`\n${event.stderr_tail}\n\`\`\``
      : "";
    store.addMessage(sessionId, {
      id: nextMessageId(),
      role: "assistant",
      content:
        `**${userError.title}**\n\n${userError.message}` +
        (userError.remediation ? `\n\n**How to fix:** ${userError.remediation}` : "") +
        stderrBlock,
      timestamp: now,
      activityIds: [],
      isStreaming: false,
      restartable: true,
    });
  }
  // Clean exit (code 0): no message needed
}

// ── Stale connection detection (progressive) ──
// Monitors for silent sessions and provides escalating feedback.
// Uses a single shared interval that checks ALL registered sessions,
// instead of one timer per session (N sessions = N timers was wasteful).
const staleSessions = new Set<string>();
const staleWarningCount = new Map<string, number>();
let sharedStaleTimer: ReturnType<typeof setInterval> | null = null;

async function checkAllStaleSessions(): Promise<void> {
  const s = useSessionStore.getState();

  for (const sessionId of staleSessions) {
    const isBusy = s.sessionBusy.get(sessionId) ?? false;
    if (!isBusy) {
      staleWarningCount.set(sessionId, 0);
      continue;
    }

    const lastTs = s.lastEventTimestamp.get(sessionId) ?? 0;
    const elapsed = Date.now() - lastTs;

    // Only check if truly silent for >120s and not streaming text
    if (elapsed <= 120_000) continue;
    const streaming = s.sessionStreaming.get(sessionId);
    if (streaming?.isStreaming) continue;

    // Check if the process is actually still alive
    try {
      const { checkProcessAlive } = await import("../tauri-commands");
      const alive = await checkProcessAlive(sessionId);

      if (!alive) {
        const now = new Date().toISOString();
        s.setSessionBusy(sessionId, false);
        if (s.sessionStreaming.get(sessionId)?.isStreaming) {
          s.finalizeStreaming(sessionId);
        }
        s.addMessage(sessionId, {
          id: `recovered-${Date.now()}`,
          role: "assistant",
          content:
            "**Session ended.** The Claude Code process exited without a completion signal.\n\n" +
            "Your work is saved. You can send a new message to continue.",
          timestamp: now,
          activityIds: [],
          isStreaming: false,
          restartable: true,
        });
        showToast("Session recovered — process had ended", "info", 6000);
        staleWarningCount.set(sessionId, 0);
        continue;
      }
    } catch (e) {
      console.error("[stale-detection] Failed to check process health:", e);
    }

    // Process is alive — progressive warnings
    const count = (staleWarningCount.get(sessionId) ?? 0) + 1;
    staleWarningCount.set(sessionId, count);

    const elapsedMin = Math.round(elapsed / 60_000);
    if (count === 1) {
      showToast(`No events for ${elapsedMin}m — Claude may be working on a complex task`, "info", 10000);
    } else if (count === 2) {
      showToast(`Still no events after ${elapsedMin}m — process is alive, likely deep in analysis`, "info", 10000);
    } else if (count % 3 === 0) {
      // Every 3rd check (~45s intervals after first), remind the user
      showToast(`No events for ${elapsedMin}m — process still running`, "info", 8000);
    }
  }
}

export function startStaleDetection(sessionId: string): void {
  staleSessions.add(sessionId);
  const store = useSessionStore.getState();
  store.touchLastEvent(sessionId);
  staleWarningCount.set(sessionId, 0);

  if (!sharedStaleTimer) {
    sharedStaleTimer = setInterval(checkAllStaleSessions, 15_000);
  }
}

export function stopStaleDetection(sessionId: string): void {
  staleSessions.delete(sessionId);
  staleWarningCount.delete(sessionId);

  if (staleSessions.size === 0 && sharedStaleTimer) {
    clearInterval(sharedStaleTimer);
    sharedStaleTimer = null;
  }
}
