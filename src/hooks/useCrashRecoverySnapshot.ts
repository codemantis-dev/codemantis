import { useEffect, useRef } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { saveSessionMessages } from "../lib/tauri-commands";
import type { SessionMessagePayload } from "../types/session";

const SNAPSHOT_KEY = "cm:workspace-snapshot";
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_INTERVAL_MS = 60_000;
const FIRST_TICK_DELAY_MS = 2_000;

export interface WorkspaceSnapshot {
  version: number;
  savedAt: number;
  tabOrder: string[];
  projectOrder: string[];
  activeSessionId: string | null;
  activeProjectPath: string | null;
  projectActiveSession: Array<[string, string]>;
}

function buildSnapshot(): WorkspaceSnapshot {
  const s = useSessionStore.getState();
  return {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    tabOrder: [...s.tabOrder],
    projectOrder: [...s.projectOrder],
    activeSessionId: s.activeSessionId,
    activeProjectPath: s.activeProjectPath,
    projectActiveSession: Array.from(s.projectActiveSession.entries()),
  };
}

async function flushTranscripts(): Promise<void> {
  const { sessionLogsEnabled } = useSettingsStore.getState().settings;
  if (!sessionLogsEnabled) return;
  const s = useSessionStore.getState();
  const tasks: Array<Promise<void>> = [];
  for (const sessionId of s.tabOrder) {
    const session = s.sessions.get(sessionId);
    // Recovered tabs already hold restored historical messages — no point
    // re-saving them. They have no live CLI process anyway.
    if (session?.status === "paused-recovered") continue;
    const messages = s.sessionMessages.get(sessionId) ?? [];
    if (messages.length === 0) continue;
    const payloads: SessionMessagePayload[] = messages.map((m, i) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      thinkingContent: m.thinkingContent ?? null,
      sortOrder: i,
    }));
    tasks.push(
      saveSessionMessages(sessionId, payloads).catch((e) =>
        console.warn(`[crash-snapshot] transcript flush failed for ${sessionId}:`, e)
      )
    );
  }
  await Promise.all(tasks);
}

function persistSnapshot(): WorkspaceSnapshot | null {
  try {
    const snap = buildSnapshot();
    if (snap.tabOrder.length === 0) {
      window.localStorage.removeItem(SNAPSHOT_KEY);
      return null;
    }
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    return snap;
  } catch (e) {
    console.warn("[crash-snapshot] persist failed:", e);
    return null;
  }
}

let lastSnapshotJson: string | null = null;

async function tick(): Promise<void> {
  try {
    await flushTranscripts();
  } catch (e) {
    console.warn("[crash-snapshot] flush stage threw:", e);
  }
  const snap = buildSnapshot();
  const json = JSON.stringify(snap);
  if (json === lastSnapshotJson) return;
  lastSnapshotJson = json;
  persistSnapshot();
}

/**
 * Mount once near the root of the app. Every 60 seconds (plus an immediate
 * first run after a short delay, plus a final synchronous run on `beforeunload`)
 * this writes a workspace snapshot to localStorage and flushes per-session
 * transcripts to SQLite. Worst-case data loss on a violent shutdown is ~60s.
 *
 * Idempotent: calling repeatedly mounts a single timer.
 */
export function useCrashRecoverySnapshot(): void {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const initialTimer = setTimeout(() => {
      void tick();
    }, FIRST_TICK_DELAY_MS);

    const interval = setInterval(() => {
      void tick();
    }, SNAPSHOT_INTERVAL_MS);

    const onBeforeUnload = (): void => {
      // Sync only — async tasks won't reliably finish here. Transcript flushes
      // happen via close_session during graceful Rust shutdown.
      try {
        persistSnapshot();
      } catch {
        /* swallow */
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      mountedRef.current = false;
    };
  }, []);
}

/**
 * Read the most recent snapshot from localStorage, or null if there is no
 * snapshot or the version doesn't match. Pure — safe to call before mount.
 */
export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    if (parsed.version !== SNAPSHOT_VERSION) return null;
    return parsed;
  } catch (e) {
    console.warn("[crash-snapshot] read failed:", e);
    return null;
  }
}

export function clearWorkspaceSnapshot(): void {
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
  lastSnapshotJson = null;
}

// Test-only: reset the dirty-tracking memo. Used by Vitest tests so the
// snapshot timer behaves deterministically across cases.
export const __resetCrashRecoverySnapshotMemoForTests = (): void => {
  lastSnapshotJson = null;
};
