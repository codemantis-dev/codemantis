import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { saveSessionMessages } from "./tauri-commands";
import type { SessionMessagePayload } from "../types/session";

const FLUSH_DEBOUNCE_MS = 500;

const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function flushNow(sessionId: string): Promise<void> {
  if (!useSettingsStore.getState().settings.sessionLogsEnabled) return;
  const state = useSessionStore.getState();
  const session = state.sessions.get(sessionId);
  // Skip placeholders — they hold restored history we shouldn't re-save.
  if (session?.status === "paused-recovered") return;
  const messages = state.sessionMessages.get(sessionId) ?? [];
  if (messages.length === 0) return;
  const payloads: SessionMessagePayload[] = messages.map((m, i) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    thinkingContent: m.thinkingContent ?? null,
    sortOrder: i,
  }));
  try {
    await saveSessionMessages(sessionId, payloads);
  } catch (e) {
    console.warn(`[session-transcript] flush failed for ${sessionId}:`, e);
  }
}

/**
 * Schedule an eager transcript flush for `sessionId`, debounced by 500ms.
 * Repeated calls within the window coalesce into one `saveSessionMessages`
 * invocation, so a burst of message events (e.g. a stream finishing on the
 * heels of a tool call) doesn't fan out into N SQLite writes.
 *
 * Backed by the same Tauri command as the 60s safety-net snapshot — the
 * server side is idempotent (DELETE+REINSERT keyed by session_id).
 */
export function scheduleFlushTranscript(sessionId: string): void {
  const existing = flushTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    flushTimers.delete(sessionId);
    void flushNow(sessionId);
  }, FLUSH_DEBOUNCE_MS);
  flushTimers.set(sessionId, timer);
}

export function __cancelAllFlushesForTests(): void {
  for (const timer of flushTimers.values()) clearTimeout(timer);
  flushTimers.clear();
}

export const __FLUSH_DEBOUNCE_MS_FOR_TESTS = FLUSH_DEBOUNCE_MS;
