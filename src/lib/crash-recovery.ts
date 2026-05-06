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
 * `restorePausedSession` action. Fails silently — a missing snapshot or
 * empty crash list is the normal clean-startup case.
 *
 * After restoration, was_open is cleared via acknowledgeCrashedSessions so
 * the same crash isn't re-reported.
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

    for (const entry of orderedEntries) {
      try {
        await restorePausedSession(entry);
      } catch (e) {
        console.warn(`[crash-recovery] Failed to restore session ${entry.session_id}:`, e);
      }
    }

    if (snapshot?.activeSessionId && byId.has(snapshot.activeSessionId)) {
      useSessionStore.getState().setActiveSession(snapshot.activeSessionId);
    }

    try {
      await acknowledgeCrashedSessions(orderedEntries.map((e) => e.session_id));
    } catch (e) {
      console.warn("[crash-recovery] Failed to acknowledge crashed sessions:", e);
    }
    clearWorkspaceSnapshot();

    showToast(
      `Recovered ${orderedEntries.length} session${orderedEntries.length === 1 ? "" : "s"} from an unexpected shutdown`,
      "info",
    );
  } catch (e) {
    console.warn("[crash-recovery] Hydration failed:", e);
  }
}
