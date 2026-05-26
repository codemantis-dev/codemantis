import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useUiStore } from "../stores/uiStore";

/** No-progress threshold in ms. Picked to be longer than any normal
 *  Bash command we'd reasonably wait on without UI feedback, but short
 *  enough that a stuck session doesn't feel infinite. */
const STUCK_THRESHOLD_MS = 30_000;

/** Watchdog tick interval. Cheap — only walks active busy sessions
 *  and reads three Maps. */
const TICK_INTERVAL_MS = 5_000;

/**
 * Detects sessions whose Codex/Claude process has gone silent and
 * surfaces them via `sessionStore.sessionStuck` so StuckActivityBanner
 * can render an actionable UI.
 *
 * Two stuck-state shapes (see SessionStuckInfo):
 *   * `no-progress`: session is busy but `lastEventTimestamp` is
 *     stale > 30s and the approval queue is empty. Usually a hung CLI.
 *   * `pending-approval-not-shown`: an approval is queued in
 *     `activityStore.approvalQueue` but the modal isn't open. Likely a
 *     lost emit (defect #1 fixed in spawn.rs) or a race during route
 *     change — the banner offers a one-click reopen.
 *
 * UI-only: the watchdog never auto-stops or auto-resolves. The
 * user-facing banner has the buttons.
 *
 * Mount once at the App level alongside `useToolApprovalListener`.
 */
export function useStuckActivityWatchdog(): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const sessionState = useSessionStore.getState();
      const activityState = useActivityStore.getState();
      const uiState = useUiStore.getState();

      const now = Date.now();
      const busySessionIds = Array.from(sessionState.sessionBusy.entries())
        .filter(([, busy]) => busy)
        .map(([id]) => id);

      // Track per-session approval-queue depth so a globally empty
      // queue doesn't mask a session-local pending approval.
      const queueBySession = new Map<string, number>();
      for (const a of activityState.approvalQueue) {
        queueBySession.set(a.sessionId, (queueBySession.get(a.sessionId) ?? 0) + 1);
      }

      for (const sessionId of busySessionIds) {
        const lastEvent = sessionState.lastEventTimestamp.get(sessionId);
        // If we never saw an event for this session yet, fall back to
        // busySince — a session that's been "busy" since spawn but
        // never emitted ANY event is the more interesting stuck case.
        const reference = lastEvent ?? sessionState.busySince.get(sessionId) ?? now;
        const elapsed = now - reference;

        const queueDepth = queueBySession.get(sessionId) ?? 0;
        const modalOpen = uiState.showApprovalModal;

        if (queueDepth > 0 && !modalOpen) {
          // Approval queued but no modal — this is the recoverable
          // case and gets prioritised even before the 30s threshold
          // (an approval that disappeared mid-route-change should be
          // surfaced fast).
          sessionState.setSessionStuck(sessionId, {
            since: reference,
            reason: "pending-approval-not-shown",
          });
          continue;
        }

        if (elapsed > STUCK_THRESHOLD_MS) {
          sessionState.setSessionStuck(sessionId, {
            since: reference,
            reason: "no-progress",
          });
        } else {
          // Below threshold → clear any previous stuck flag. (The
          // store's setter is idempotent on absence, so no thrash.)
          sessionState.setSessionStuck(sessionId, null);
        }
      }

      // Also clear stuck state for any session that's no longer busy
      // — setSessionBusy(false) handles this already, but a defensive
      // sweep catches anything we missed.
      for (const sessionId of sessionState.sessionStuck.keys()) {
        if (!sessionState.sessionBusy.get(sessionId)) {
          sessionState.setSessionStuck(sessionId, null);
        }
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);
}
