import {
  listCrashedSessions,
  acknowledgeCrashedSessions,
  consumeWakeRecoveryFlag,
  listLiveSessions,
} from "./tauri-commands";
import {
  readWorkspaceSnapshot,
  clearWorkspaceSnapshot,
} from "../hooks/useCrashRecoverySnapshot";
import { useSessionStore } from "../stores/sessionStore";
import { showToast } from "../stores/toastStore";
import type { Session, SessionHistoryEntry } from "../types/session";

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
  reattachLiveSession?: (info: Session) => Promise<void>,
): Promise<void> {
  try {
    // Wake-recovery branch: if the previous frontend was reloaded by the
    // Rust wake observer (last-resort `WebviewWindow::reload()` after a
    // hung WebContent process), the Rust backend and its per-session CLI
    // subprocesses are still alive. Re-attach to those directly — no
    // --resume spawn, no "paused-recovered" placeholder tab. This is the
    // post-suspend "wake state must restore" path: tabs come back as
    // live, running sessions in their original order with the same
    // active selection.
    if (reattachLiveSession) {
      const wakeRecovery = await consumeWakeRecoveryFlag().catch(() => false);
      if (wakeRecovery) {
        await handleWakeRecoveryBoot(restorePausedSession, reattachLiveSession);
        return;
      }
    }

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

/**
 * Post-wake-recovery hydration. Splits the snapshot-restored tabs into two
 * buckets — sessions whose CLI subprocess is still alive in the backend's
 * `AppState.processes` (re-attach in place, no `--resume` spawn) and
 * sessions whose process died while the WebContent was hung (fall through
 * to the existing `restorePausedSession` path so the user can decide to
 * resume from disk).
 *
 * The full pre-reload tab layout is reconstructed even when every session
 * is live: tab order from the localStorage snapshot, active selection from
 * the same snapshot. Failure-handling mirrors the crash path —
 * `acknowledgeCrashedSessions` is only called for IDs that actually
 * restored, so a session that fails to re-attach stays in `was_open=1`
 * and shows up in Resume Session on next boot.
 */
async function handleWakeRecoveryBoot(
  restorePausedSession: (entry: SessionHistoryEntry) => Promise<void>,
  reattachLiveSession: (info: Session) => Promise<void>,
): Promise<void> {
  const [liveSessions, crashed] = await Promise.all([
    listLiveSessions().catch((e) => {
      console.error("[wake-recovery] listLiveSessions failed — treating all sessions as dead:", e);
      return [] as Session[];
    }),
    listCrashedSessions(),
  ]);

  const liveById = new Map(liveSessions.map((s) => [s.id, s]));
  const crashedById = new Map(crashed.map((e) => [e.session_id, e]));

  // Union of ids we know about. Live sessions take precedence — if the
  // same id appears in both lists, the CLI is alive and we re-attach.
  const allIds = new Set<string>([
    ...liveSessions.map((s) => s.id),
    ...crashed.map((e) => e.session_id),
  ]);

  if (allIds.size === 0) {
    // The flag fired but neither bucket has anything to restore (rare:
    // user closed all tabs between the wake observer setting the flag
    // and the post-reload boot). Treat as a clean exit.
    clearWorkspaceSnapshot();
    return;
  }

  const snapshot = readWorkspaceSnapshot();
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  if (snapshot) {
    for (const id of snapshot.tabOrder) {
      if (allIds.has(id)) {
        orderedIds.push(id);
        seen.add(id);
      }
    }
  }
  // Anything not in the snapshot (newly opened after the last snapshot tick,
  // or snapshot missing entirely) appends in live-first then crashed order.
  for (const s of liveSessions) {
    if (!seen.has(s.id)) {
      orderedIds.push(s.id);
      seen.add(s.id);
    }
  }
  for (const e of crashed) {
    if (!seen.has(e.session_id)) {
      orderedIds.push(e.session_id);
      seen.add(e.session_id);
    }
  }

  let reattached = 0;
  let restoredFromDisk = 0;
  let failed = 0;
  const ackIds: string[] = [];

  for (const id of orderedIds) {
    const live = liveById.get(id);
    if (live) {
      try {
        await reattachLiveSession(live);
        reattached += 1;
        // Only ack if this id is also in the crashed list (otherwise
        // there's no was_open=1 row to clear). A live-only session has
        // its flag managed by the normal session lifecycle.
        if (crashedById.has(id)) ackIds.push(id);
      } catch (e) {
        failed += 1;
        console.error(
          `[wake-recovery] Failed to re-attach live session ${id}; it remains in Resume Session:`,
          e,
        );
      }
      continue;
    }
    const entry = crashedById.get(id);
    if (!entry) continue;
    try {
      await restorePausedSession(entry);
      restoredFromDisk += 1;
      ackIds.push(id);
    } catch (e) {
      failed += 1;
      console.error(
        `[wake-recovery] Failed to restore dead session ${id} from disk; it remains in Resume Session:`,
        e,
      );
    }
  }

  if (snapshot?.activeSessionId && allIds.has(snapshot.activeSessionId)) {
    useSessionStore.getState().setActiveSession(snapshot.activeSessionId);
  }

  if (ackIds.length > 0) {
    try {
      await acknowledgeCrashedSessions(ackIds);
    } catch (e) {
      console.error(
        "[wake-recovery] Failed to acknowledge restored sessions — they may re-surface on next restart:",
        e,
      );
    }
  }
  clearWorkspaceSnapshot();

  const noun = (n: number) => `session${n === 1 ? "" : "s"}`;
  const total = reattached + restoredFromDisk;
  if (total === 0 && failed > 0) {
    showToast(
      `The webview was reloaded after wake but ${failed} ${noun(failed)} couldn't be restored — find them in Open → Resume Session`,
      "error",
    );
  } else if (reattached > 0 && restoredFromDisk === 0 && failed === 0) {
    // The happy path: every tab came back as a still-running live
    // session. This is the "wake_state_must_restore" win the rule asks
    // for — surfaced as info so the user knows recovery ran but doesn't
    // see an error-styled toast for a benign recovery.
    showToast(
      `Webview was reloaded after wake — ${reattached} ${noun(reattached)} restored, still running`,
      "info",
    );
  } else if (failed === 0) {
    showToast(
      `Webview was reloaded after wake — ${reattached} live, ${restoredFromDisk} restored from disk`,
      "info",
    );
  } else {
    showToast(
      `Webview was reloaded after wake — ${total} of ${total + failed} ${noun(total + failed)} restored; the rest are in Open → Resume Session`,
      "info",
    );
  }
}
