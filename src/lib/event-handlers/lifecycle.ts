import type {
  UsageUpdateEvent,
} from "../../types/agent-events";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChangelogStore } from "../../stores/changelogStore";
import { showToast } from "../../stores/toastStore";
import { getContextWindowForModel } from "../model-context";
import { streamingBuffers, pendingFrames } from "./chat";
import { stopStaleDetection } from "./process";
import { MUTATING_TOOLS, turnToolCallCount } from "./activity";

// Store state types (derived from Zustand store getState())
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

export function handleUsageUpdate(sessionId: string, event: UsageUpdateEvent, store: SessionStoreState): void {
  store.touchLastEvent(sessionId);
  // Per-API-call usage from message_delta events — accumulate incrementally
  store.accumulateUsage(
    sessionId,
    event.usage.input_tokens ?? 0,
    event.usage.output_tokens ?? 0,
    event.usage.cache_creation_input_tokens ?? 0,
    event.usage.cache_read_input_tokens ?? 0,
    // Codex-only: reasoning_output_tokens — the model's hidden reasoning
    // count. Claude leaves this undefined.
    event.usage.reasoning_output_tokens ?? 0,
  );
  // Real-time context update: each usage_update represents a single API
  // call, so the total tokens IS the context window size at that point.
  const callContext =
    (event.usage.input_tokens ?? 0) +
    (event.usage.cache_creation_input_tokens ?? 0) +
    (event.usage.cache_read_input_tokens ?? 0) +
    (event.usage.output_tokens ?? 0);
  if (callContext > 0) {
    // Use the largest known max — protects against CLI under-reporting for [1m] models
    const settingsDefaultForUsage = useSettingsStore.getState().settings.defaultContextWindow;
    const modelMaxForUsage = getContextWindowForModel(store.sessions.get(sessionId)?.model, settingsDefaultForUsage);
    const currentMax = Math.max(
      store.sessionContext.get(sessionId)?.max ?? 0,
      modelMaxForUsage,
    );
    store.updateContext(sessionId, callContext, currentMax);
    checkContextThresholds(sessionId);
  }
}

export function checkContextThresholds(sessionId: string): void {
  const store = useSessionStore.getState();
  const ctx = store.sessionContext.get(sessionId);
  if (!ctx || ctx.max === 0) return;

  const pct = ctx.used / ctx.max;
  const fired = store.contextToastFired.get(sessionId) ?? new Set();

  if (pct >= 0.95 && !fired.has(95)) {
    store.markContextToastFired(sessionId, 95);
    showToast(
      "Context window is 95% full. Run /compact to free space before the session stalls.",
      "error",
      15000
    );
  } else if (pct >= 0.80 && !fired.has(80)) {
    store.markContextToastFired(sessionId, 80);
    showToast(
      "Context window is 80% full. Consider running /compact to free space.",
      "info",
      10000
    );
  }
}

export function maybeGenerateChangelog(sessionId: string): void {
  const settings = useSettingsStore.getState().settings;
  if (!settings.changelogEnabled) return;

  const activityEntries = useActivityStore.getState().getActiveEntries(sessionId);
  const messages = useSessionStore.getState().sessionMessages.get(sessionId) ?? [];

  // Check if any mutating tools were used in this turn
  const hasMutatingTool = activityEntries.some((e) => MUTATING_TOOLS.has(e.toolName));
  if (!hasMutatingTool) return;

  // Get the last user prompt
  let userPrompt = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userPrompt = messages[i].content.slice(0, 500);
      break;
    }
  }

  // Get last assistant message text
  let assistantSummary = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content.length > 50) {
      assistantSummary = messages[i].content.slice(0, 800);
      break;
    }
  }
  if (!assistantSummary) return;

  // Collect detailed tool operations with context about what was done
  const toolsUsed = activityEntries
    .filter((e) => MUTATING_TOOLS.has(e.toolName))
    .map((e) => {
      const filePath = (e.toolInput?.file_path as string) ?? "";
      const command = (e.toolInput?.command as string) ?? "";
      const oldStr = (e.toolInput?.old_string as string) ?? "";
      const newStr = (e.toolInput?.new_string as string) ?? "";
      const content = (e.toolInput?.content as string) ?? "";

      let detail = `${e.toolName}:`;
      if (e.toolName === "Edit" && filePath) {
        const preview = oldStr ? ` replaced "${oldStr.slice(0, 60)}" → "${newStr.slice(0, 60)}"` : "";
        detail = `Edit: ${filePath}${preview}`;
      } else if (e.toolName === "Write" && filePath) {
        const lines = content ? ` (${content.split("\n").length} lines)` : "";
        detail = `Write: ${filePath}${lines}`;
      } else if (e.toolName === "Bash" && command) {
        detail = `Bash: ${command.slice(0, 120)}`;
      } else if (filePath) {
        detail = `${e.toolName}: ${filePath}`;
      }
      return detail.slice(0, 200);
    });

  // Get current session mode (normal, auto-accept, plan)
  const sessionMode = useSessionStore.getState().sessionModes.get(sessionId) ?? "normal";

  // Fire and forget — non-blocking
  const changelogStore = useChangelogStore.getState();
  changelogStore.setGenerating(sessionId, true);

  import("../tauri-commands").then(({ generateChangelogEntry }) => {
    generateChangelogEntry(sessionId, userPrompt, assistantSummary, toolsUsed, sessionMode)
      .then((entry) => {
        useChangelogStore.getState().addEntry(sessionId, entry);
      })
      .catch((e) => {
        console.error("Failed to generate changelog entry:", e);
      })
      .finally(() => {
        useChangelogStore.getState().setGenerating(sessionId, false);
      });
  });
}

/** Clean up all module-level caches for a closed session. */
export function cleanupSession(sessionId: string): void {
  stopStaleDetection(sessionId);
  streamingBuffers.delete(sessionId);
  const frame = pendingFrames.get(sessionId);
  if (frame && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  }
  pendingFrames.delete(sessionId);
  turnToolCallCount.delete(sessionId);
}
