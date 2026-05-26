import {
  listCrashedSessions,
  acknowledgeCrashedSessions,
} from "./tauri-commands";
import {
  readWorkspaceSnapshot,
  clearWorkspaceSnapshot,
} from "../hooks/useCrashRecoverySnapshot";
import { useSessionStore } from "../stores/sessionStore";
import { showToast } from "../stores/toastStore";
import type { SessionHistoryEntry } from "../types/session";

/**
 * Crash-recovery hydration. Reads the workspace snapshot from localStorage
 * (tab order + active selection) and the `was_open=1` rows from SQLite, then
 * redraws each surviving session as a paused-recovered tab via the supplied
 * `restorePausedSession` action.
 *
 * IMPORTANT — failure semantics:
 *   • A session that THROWS during restoration keeps its `was_open=1` flag.
 *     We DO NOT acknowledge it, so it remains visible in the Resume Session
 *     tab (database.rs:list_recent_closed_sessions accepts was_open=1 rows
 *     specifically as the safety net for this case) and the user can try
 *     again on the next restart.
 *   • Only the IDs that actually restored are passed to
 *     `acknowledgeCrashedSessions`. A transient frontend error must never
 *     silently retire a session the user cared about.
 *   • Every outcome (success / partial / total failure) emits a toast so the
 *     user sees that recovery ran. Silent recovery is what got us into this
 *     mess in the first place.
 */
export async function hydratePersistedOpenSessions(
  restorePausedSession: (entry: SessionHistoryEntry) => Promise<void>,
): Promise<void> {
  try {
    const crashed = await listCrashedSessions();
    if (crashed.length === 0) {
      // Snapshot is only meaningful alongside crashed rows. Wipe it so a
      // future graceful-then-violent sequence doesn't surface a stale layout.
      clearWorkspaceSnapshot();
      return;
    }

    const snapshot = readWorkspaceSnapshot();
    const byId = new Map(crashed.map((e) => [e.session_id, e]));

    // Order: prefer the snapshot's tabOrder when available; otherwise fall
    // back to the crashed list's natural order (created_at ASC).
    const orderedEntries: SessionHistoryEntry[] = [];
    const seen = new Set<string>();
    if (snapshot) {
      for (const id of snapshot.tabOrder) {
        const entry = byId.get(id);
        if (entry) {
          orderedEntries.push(entry);
          seen.add(id);
        }
      }
    }
    for (const entry of crashed) {
      if (!seen.has(entry.session_id)) orderedEntries.push(entry);
    }

    const restoredIds: string[] = [];
    const failedIds: string[] = [];
    for (const entry of orderedEntries) {
      try {
        await restorePausedSession(entry);
        restoredIds.push(entry.session_id);
      } catch (e) {
        failedIds.push(entry.session_id);
        // console.error (not warn): a failed restoration is a real bug we
        // want surfaced in the dev console and downstream telemetry. The
        // session is NOT lost — was_open=1 keeps it in Resume Session — but
        // the user still had to take an extra step.
        console.error(
          `[crash-recovery] Failed to restore session ${entry.session_id}; it remains visible in Resume Session:`,
          e,
        );
      }
    }
    const restored = restoredIds.length;
    const failed = failedIds.length;

    if (snapshot?.activeSessionId && byId.has(snapshot.activeSessionId)) {
      useSessionStore.getState().setActiveSession(snapshot.activeSessionId);
    }

    // Only acknowledge sessions that actually restored. Failed ones keep
    // was_open=1 so the next boot can retry, AND they remain reachable via
    // the Resume Session tab in the meantime.
    if (restoredIds.length > 0) {
      try {
        await acknowledgeCrashedSessions(restoredIds);
      } catch (e) {
        console.error(
          "[crash-recovery] Failed to acknowledge restored sessions — they may re-surface on next restart:",
          e,
        );
      }
    }
    clearWorkspaceSnapshot();

    const noun = (n: number) => `session${n === 1 ? "" : "s"}`;
    if (restored === 0 && failed > 0) {
      // Total failure — be explicit that the user has a fallback.
      showToast(
        `Couldn't auto-restore ${failed} ${noun(failed)} from an unexpected shutdown — find them in Open → Resume Session`,
        "error",
      );
    } else if (failed > 0) {
      showToast(
        `Recovered ${restored} of ${restored + failed} ${noun(restored + failed)} — the ${failed} that failed are in Open → Resume Session`,
        "info",
      );
    } else {
      showToast(
        `Recovered ${restored} ${noun(restored)} from an unexpected shutdown`,
        "info",
      );
    }
  } catch (e) {
    console.error("[crash-recovery] Hydration failed:", e);
    showToast(
      "Crash recovery failed — your previous sessions are in Open → Resume Session",
      "error",
    );
  }
}
