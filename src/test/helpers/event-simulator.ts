/**
 * Simulate CLI event streams flowing through the real event pipeline.
 * Integration tests use this to exercise handleChatEvent/handleActivityEvent
 * with real Zustand stores (only Tauri IPC is mocked).
 */
import type { FrontendEvent } from "../../types/claude-events";
import { handleChatEvent, handleActivityEvent } from "../../lib/event-classifier";

/** Chat event types that are routed through handleChatEvent */
const CHAT_EVENT_TYPES = new Set([
  "session_init",
  "text_delta",
  "text_complete",
  "thinking_delta",
  "thinking_complete",
  "turn_complete",
  "process_error",
  "process_exited",
  "cli_session_id",
  "compacting_status",
  "compact_complete",
  "rate_limit_warning",
  "usage_update",
  "interrupt_result",
  "model_changed",
  "capabilities_discovered",
]);

/** Activity event types that are routed through handleActivityEvent */
const ACTIVITY_EVENT_TYPES = new Set([
  "tool_use_start",
  "tool_result",
  "tool_progress",
  "agent_preparing",
  "subagent_started",
  "subagent_progress",
  "subagent_complete",
  "task_notification",
  "task_updated",
]);

/**
 * Route a single event through the real event pipeline.
 * Automatically determines whether to call handleChatEvent or handleActivityEvent
 * based on event type.
 */
export function simulateCLIEvent(sessionId: string, event: FrontendEvent): void {
  if (CHAT_EVENT_TYPES.has(event.type)) {
    handleChatEvent(sessionId, event);
  }
  if (ACTIVITY_EVENT_TYPES.has(event.type)) {
    handleActivityEvent(sessionId, event);
  }
}

/**
 * Replay a sequence of events through the real event pipeline.
 * Events are processed synchronously in order.
 */
export function simulateEventStream(sessionId: string, events: FrontendEvent[]): void {
  for (const event of events) {
    simulateCLIEvent(sessionId, event);
  }
}

/**
 * Replay events with async delays between them (for testing debounce/timing).
 * Each event is processed after a configurable delay.
 */
export async function simulateEventStreamAsync(
  sessionId: string,
  events: FrontendEvent[],
  delayMs: number = 10
): Promise<void> {
  for (const event of events) {
    simulateCLIEvent(sessionId, event);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
