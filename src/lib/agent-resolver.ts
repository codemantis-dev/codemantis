import type { AgentId } from "../types/agent-events";
import type { TaskCategory } from "../types/task-category";

/**
 * Per-task agent routing resolver (v1.5.0 Phase 1).
 *
 * Single source of truth for "which agent should spawn here?". Every
 * session-spawn callsite calls `resolveAgentForTask` instead of
 * hardcoding `claude_code`. Pure — no IPC, no async, fully unit-testable.
 *
 * Resolution rule, in order:
 *   1. The per-task override in settings, if set for this category.
 *   2. Otherwise the user's primary agent (the global default picked in
 *      Settings → Agents, persisted as `selectedAgentId` in the UI store).
 *   3. If the chosen agent's CLI is not installed, fall back to the
 *      other agent if IT is installed.
 *   4. If neither is installed (shouldn't happen — at least one must be
 *      for the app to function), return `claude_code` as the canonical
 *      path.
 *
 * The function ALWAYS returns an agent; callers never need a fallback.
 */

/** Which local CLIs are installed on this machine. */
export interface AgentInstallState {
  claude_code: boolean;
  codex: boolean;
}

/** The slice of settings the resolver reads — keeps the signature narrow. */
export interface AgentRoutingSettings {
  defaultAgentByTask: Partial<Record<TaskCategory, AgentId>>;
}

export function resolveAgentForTask(
  task: TaskCategory,
  settings: AgentRoutingSettings,
  primary: AgentId,
  install: AgentInstallState,
): AgentId {
  // 1 + 2 — per-task override, else primary.
  const desired: AgentId = settings.defaultAgentByTask[task] ?? primary;

  // 3 — honour the choice only if its CLI is actually installed.
  if (install[desired]) return desired;

  // 4 — graceful fallback to whichever agent IS installed.
  const fallback = otherAgent(desired);
  if (install[fallback]) return fallback;

  // 5 — neither installed: canonical default. The app can't really
  // function in this state, but returning a concrete agent keeps every
  // caller's type contract intact (no nulls to handle).
  return "claude_code";
}

/** The agent that ISN'T the given one — used by `/second-opinion` to
 * pick whom to ask, and by the resolver's fallback path. */
export function otherAgent(a: AgentId): AgentId {
  return a === "codex" ? "claude_code" : "codex";
}

// ── Impure convenience wrapper ──────────────────────────────────────
//
// The functions above are pure + unit-tested. The wrapper below reads
// live store state so the 6 session-spawn callsites stay one-liners.
// Kept in this file so all agent-routing logic lives in one place; the
// store imports create no cycle (uiStore / settingsStore don't import
// this module).

import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";

/** Resolve the agent for `task` from current store state. The thin
 * non-pure shim every spawn callsite uses. */
export function resolveAgentForTaskNow(task: TaskCategory): AgentId {
  const settings = useSettingsStore.getState().settings;
  const ui = useUiStore.getState();
  return resolveAgentForTask(
    task,
    { defaultAgentByTask: settings.defaultAgentByTask },
    ui.selectedAgentId,
    ui.agentInstall,
  );
}
