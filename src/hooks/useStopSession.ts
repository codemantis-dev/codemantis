import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "../stores/sessionStore";
import {
  interruptSession,
  pauseSessionProcess,
  resumeSessionProcess,
} from "../lib/tauri-commands";
import { showToast } from "../stores/toastStore";

/** How long to wait for the graceful interrupt to take effect before
 *  escalating to the forceful kill/respawn path. The graceful interrupt
 *  relies on the CLI emitting `turn_complete` to clear busy; a wedged CLI
 *  never does, so we force after this window. */
export const FORCE_STOP_TIMEOUT_MS = 4000;

/** Activity labels shown while a stop is in progress. Exported so the
 *  InputArea Stop button can reflect the current phase reactively (the
 *  store's `sessionActivity` is the reactive surface; the ref-based
 *  `getStopPhase` is for non-reactive callers/tests). */
export const STOPPING_LABEL = "Stopping...";
export const FORCE_STOPPING_LABEL = "Force-stopping...";

export type StopPhase = "idle" | "stopping" | "forcing";

interface StopEntry {
  phase: Exclude<StopPhase, "idle">;
  timerId: ReturnType<typeof setTimeout> | null;
}

export interface UseStopSessionResult {
  /** Stop generation for a main-chat session. First call sends a graceful
   *  interrupt; a second call (or a 4s timeout with the session still busy)
   *  escalates to the forceful path. No-op if the session isn't busy. */
  stopSession: (sessionId: string) => void;
  /** Current escalation phase for a session (non-reactive — reads a ref). */
  getStopPhase: (sessionId: string) => StopPhase;
}

/**
 * Single escalating "stop generation" action for main-chat sessions.
 *
 * Phase 1 (graceful): sends `interruptSession` and shows "Stopping…". If the
 * CLI acknowledges (emits `turn_complete` → `setSessionBusy(false)`) we're done
 * and the pending escalation is cancelled.
 *
 * Phase 2 (force): if the session is still busy `FORCE_STOP_TIMEOUT_MS` after
 * the graceful attempt, OR the user calls `stopSession` again while "stopping",
 * escalate — Codex is killed and respawned (resuming the same thread, context
 * preserved), and for both agents we locally finalize streaming + clear busy so
 * the UI unsticks even when the CLI never responds. This is the proven sequence
 * from `StuckActivityBanner` / `useClaudeSession.reviveCodexSession`.
 *
 * NOTE: operates on the main-chat `sessionStore` ONLY. The assistant panel
 * cancels via `useAssistantSession.cancelAssistant` against the separate
 * `assistantStore` — do not point that path at this hook (different store).
 */
export function useStopSession(): UseStopSessionResult {
  const entries = useRef<Map<string, StopEntry>>(new Map());

  // When a session's busy flag clears (the graceful happy path, or any other
  // completion), cancel its pending escalation so a stale timer can't force a
  // healthy — possibly already-restarted — session.
  useEffect(() => {
    const map = entries.current;
    const unsubscribe = useSessionStore.subscribe((state) => {
      for (const [sessionId, entry] of map) {
        if (!state.sessionBusy.get(sessionId)) {
          if (entry.timerId !== null) clearTimeout(entry.timerId);
          map.delete(sessionId);
        }
      }
    });
    return () => {
      unsubscribe();
      for (const entry of map.values()) {
        if (entry.timerId !== null) clearTimeout(entry.timerId);
      }
      map.clear();
    };
  }, []);

  const forceStop = useCallback(async (sessionId: string): Promise<void> => {
    const store = useSessionStore.getState();
    const session = store.sessions.get(sessionId);
    store.setSessionActivity(sessionId, {
      label: FORCE_STOPPING_LABEL,
      toolName: null,
      toolElapsed: 0,
      filePath: null,
    });
    try {
      if (session?.agent_id === "codex") {
        // A wedged Codex app-server ignores the graceful turn/interrupt — kill
        // the process and respawn it resuming the same thread. The conversation
        // is reloaded from the thread's rollout, so only the runaway turn drops.
        await pauseSessionProcess(sessionId);
        await resumeSessionProcess(sessionId, session.cli_session_id ?? null);
      }
      const after = useSessionStore.getState();
      if (after.sessionStreaming.get(sessionId)?.isStreaming) {
        after.finalizeStreaming(sessionId);
      }
      // Clears sessionActivity, activeSubAgents, sessionStuck, busySince too —
      // hides the stuck banner and returns the input to Send.
      after.setSessionBusy(sessionId, false);
    } catch (e) {
      console.error("Force-stop failed:", e);
      showToast("Failed to force-stop the session", "error");
    } finally {
      entries.current.delete(sessionId);
    }
  }, []);

  const escalate = useCallback(
    (sessionId: string): void => {
      const entry = entries.current.get(sessionId);
      if (!entry || entry.phase === "forcing") return; // already forcing → ignore
      if (entry.timerId !== null) clearTimeout(entry.timerId);
      entry.phase = "forcing";
      entry.timerId = null;
      void forceStop(sessionId);
    },
    [forceStop]
  );

  const stopSession = useCallback(
    (sessionId: string): void => {
      const store = useSessionStore.getState();
      if (!store.sessionBusy.get(sessionId)) return; // not generating → no-op

      if (entries.current.has(sessionId)) {
        // Second press while a stop is in flight → escalate immediately.
        escalate(sessionId);
        return;
      }

      // Phase 1: graceful interrupt + optimistic status (the wedged case never
      // emits interrupt_result, so we set the label ourselves rather than wait).
      store.setSessionActivity(sessionId, {
        label: STOPPING_LABEL,
        toolName: null,
        toolElapsed: 0,
        filePath: null,
      });
      interruptSession(sessionId).catch((e) =>
        console.error("Failed to interrupt session:", e)
      );
      const timerId = setTimeout(() => {
        if (useSessionStore.getState().sessionBusy.get(sessionId)) {
          escalate(sessionId);
        } else {
          entries.current.delete(sessionId);
        }
      }, FORCE_STOP_TIMEOUT_MS);
      entries.current.set(sessionId, { phase: "stopping", timerId });
    },
    [escalate]
  );

  const getStopPhase = useCallback(
    (sessionId: string): StopPhase => entries.current.get(sessionId)?.phase ?? "idle",
    []
  );

  return { stopSession, getStopPhase };
}
