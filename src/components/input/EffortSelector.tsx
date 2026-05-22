import { useState, useMemo } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useClickOutside } from "../../hooks/useClickOutside";
import { handleError } from "../../lib/error-handler";
import { showToast } from "../../stores/toastStore";
import {
  pauseSessionProcess,
  resumeSessionProcess,
  setSessionEffort as setSessionEffortCmd,
} from "../../lib/tauri-commands";
import type { CliModelInfo } from "../../types/agent-events";

/**
 * Resolve which `CliModelInfo` corresponds to the running CLI session.
 *
 * The CLI's `system/init` event reports the *resolved* Anthropic model ID
 * (e.g. `claude-opus-4-7[1m]`) while the `initialize` capability manifest
 * lists models by their CLI alias (`default` / `sonnet` / `sonnet[1m]` /
 * `haiku`). The two strings are not equal, but they share descriptive
 * tokens — the resolved ID always contains the same family/version
 * fragments that the manifest entries put in their `displayName` /
 * `description`. We exploit that without baking any model lists into the
 * code: tokenise the resolved ID, score each manifest entry by how many
 * of those tokens appear in its searchable text, and pick the highest
 * scorer. If a `value === modelValue` exact match exists (e.g. when the
 * user passed `--model sonnet[1m]` and the CLI reports the alias
 * verbatim), it wins outright.
 *
 * Pure data flow: both inputs come from the CLI. If Anthropic adds,
 * removes, or renames a model family, the matcher follows automatically
 * because both the resolved ID and the manifest text move together.
 */
function findManifestEntry(
  models: unknown,
  modelValue: string | null | undefined,
): CliModelInfo | null {
  if (!Array.isArray(models)) return null;
  const list = models as CliModelInfo[];
  if (list.length === 0 || !modelValue) return null;

  const exact = list.find((m) => m.value === modelValue);
  if (exact) return exact;

  const idTokens = modelValue
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  if (idTokens.length === 0) return null;

  let best: CliModelInfo | null = null;
  let bestScore = 0;
  for (const m of list) {
    const haystack = `${m.value} ${m.displayName} ${m.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
    let score = 0;
    for (const t of idTokens) {
      if (haystack.includes(t)) score += 1;
    }
    if (score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

function labelFor(level: string): string {
  if (level === "xhigh") return "XHigh";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function levelIndex(level: string, levels: string[]): number {
  const idx = levels.indexOf(level);
  return idx >= 0 ? idx : 0;
}

export function EffortBars({
  level,
  levels,
}: {
  level: string;
  levels: string[];
}) {
  const total = Math.max(levels.length, 1);
  const filled = levelIndex(level, levels) + 1;
  return (
    <span className="inline-flex gap-px items-end" style={{ height: 12 }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((i) => (
        <span
          key={i}
          className="rounded-sm transition-colors"
          style={{
            width: 3,
            height: 3 + i * 2,
            background: i <= filled ? "var(--accent)" : "var(--border-light)",
          }}
        />
      ))}
    </span>
  );
}

export default function EffortSelector() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const session = useSessionStore((s) =>
    s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null,
  );
  const sessionCapabilities = useSessionStore((s) => s.sessionCapabilities);
  const sessionEffort = useSessionStore((s) =>
    s.activeSessionId ? s.sessionEffort.get(s.activeSessionId) : undefined,
  );
  const sessionStreaming = useSessionStore((s) =>
    s.activeSessionId
      ? s.sessionStreaming.get(s.activeSessionId)?.isStreaming ?? false
      : false,
  );
  const sessionBusy = useSessionStore((s) =>
    s.activeSessionId ? s.sessionBusy.get(s.activeSessionId) ?? false : false,
  );
  const setSessionEffort = useSessionStore((s) => s.setSessionEffort);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const caps = activeSessionId ? sessionCapabilities.get(activeSessionId) : undefined;
  // Resolved-model lookup: when the user hasn't picked a model yet,
  // `session.model` is null and findManifestEntry returns null, which
  // would hide the EffortSelector forever on a fresh Codex session
  // (the user's first turn would land at whatever effort the CLI
  // defaults to, with no way to change it). Fall back to the model
  // marked isDefault (or the first entry) so the manifest lookup
  // succeeds — same resolved-default pattern as ModelSelector.
  const resolvedModelValue = useMemo(() => {
    if (session?.model) return session.model;
    const list = Array.isArray(caps?.models) ? caps?.models as CliModelInfo[] : [];
    return (
      list.find((m) => m.isDefault === true)?.value ??
      list[0]?.value ??
      null
    );
  }, [session?.model, caps?.models]);
  const activeModel = useMemo(
    () => findManifestEntry(caps?.models, resolvedModelValue),
    [caps?.models, resolvedModelValue],
  );

  const supportsEffort = activeModel?.supportsEffort === true;
  const levels: string[] = activeModel?.supportedEffortLevels ?? [];

  if (!activeSessionId || !supportsEffort || levels.length === 0) {
    return null;
  }

  const persistedDefault = settings.defaultThinkingEffort ?? null;
  const runningLevel = sessionEffort ?? null;
  // Final fallback: prefer the model's own defaultEffort (Codex
  // surfaces this from model/list — e.g. gpt-5.5 default = medium).
  // Without this we'd show levels[0] ("low" for Codex models, which
  // is misleading because the CLI would actually run at medium).
  const modelDefault = activeModel?.defaultEffort ?? null;
  const displayLevel =
    (runningLevel && levels.includes(runningLevel) ? runningLevel : null) ??
    (persistedDefault && levels.includes(persistedDefault) ? persistedDefault : null) ??
    (modelDefault && levels.includes(modelDefault) ? modelDefault : null) ??
    levels[0];

  // The "pending" level is whichever one the user has marked as the default
  // for new sessions. We can offer a session restart when that differs from
  // what the running CLI process was started with.
  const pendingLevel = persistedDefault ?? null;
  const restartTarget =
    pendingLevel && levels.includes(pendingLevel) && pendingLevel !== runningLevel
      ? pendingLevel
      : null;

  const canRestart =
    !!restartTarget &&
    !sessionStreaming &&
    !sessionBusy &&
    !restarting;

  const isCodex = (session?.agent_id ?? "claude_code") === "codex";

  const handleSelect = (next: string) => {
    if (next === persistedDefault && !isCodex) {
      setOpen(false);
      return;
    }
    // Codex applies effort per-turn — commit immediately via the Tauri
    // command (no process restart needed). The optimistic local update
    // means the label reflects the click instantly; the EffortChanged
    // event from the adapter confirms it (or surfaces an error).
    if (isCodex && activeSessionId) {
      const previous = runningLevel;
      setSessionEffort(activeSessionId, next);
      setOpen(false);
      setSessionEffortCmd(activeSessionId, next).catch((err) => {
        if (previous) setSessionEffort(activeSessionId, previous);
        handleError("EffortSelector.codexSetEffort", err);
        showToast("Failed to update Codex effort.", "error");
      });
      return;
    }
    // Claude: persisted setting drives the next spawn; the restart button
    // is the only way to make it take effect on the live session.
    updateSettings({ defaultThinkingEffort: next }).catch((err) =>
      handleError("EffortSelector.persist", err),
    );
  };

  const handleRestart = async () => {
    if (!activeSessionId || !restartTarget) return;
    setRestarting(true);
    setOpen(false);
    const previous = runningLevel;
    try {
      // Claude only — Codex doesn't reach here because handleSelect commits
      // directly via setSessionEffortCmd (per-turn application).
      //
      // The Claude CLI in stream-json mode has no runtime path to change
      // effort (`set_effort` unsupported, `/effort` TTY-gated). The only
      // way to make the change take effect is to close + respawn. The new
      // spawn reads `defaultThinkingEffort` from settings and passes it
      // as the documented `--effort` flag (see process.rs::spawn). The
      // existing CLI session_id is preserved via `--resume`, so the
      // conversation continues from where it left off.
      await pauseSessionProcess(activeSessionId);
      await resumeSessionProcess(activeSessionId, undefined);
      setSessionEffort(activeSessionId, restartTarget);
      showToast(
        `Session restarted at ${labelFor(restartTarget)} effort.`,
        "success",
      );
    } catch (err) {
      if (previous) setSessionEffort(activeSessionId, previous);
      handleError("EffortSelector.restart", err);
      showToast(
        "Failed to restart session. Try again or close and reopen the session manually.",
        "error",
      );
    } finally {
      setRestarting(false);
    }
  };

  // Agent-aware copy: Codex sessions read `current_effort` per-turn
  // from the adapter handle, so "inherit X's default" wording differs.
  const agentName =
    (session?.agent_id ?? "claude_code") === "codex" ? "Codex" : "Claude Code";
  const titleParts: string[] = [];
  if (runningLevel) titleParts.push(`Current session: ${labelFor(runningLevel)}`);
  titleParts.push(
    persistedDefault
      ? `New sessions: ${labelFor(persistedDefault)}`
      : `New sessions: inherit ${agentName}'s default`,
  );
  const title = titleParts.join(" · ");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-subtle transition-colors"
        title={title}
        disabled={restarting}
      >
        <EffortBars level={displayLevel} levels={levels} />
        <span>{labelFor(displayLevel)}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-1.5 w-[280px] rounded-lg border border-border p-1 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="px-2.5 py-1.5 text-label text-text-dim border-b border-border-light mb-1">
            Default for new sessions
          </div>
          {levels.map((lvl) => {
            const isActive = lvl === persistedDefault;
            const isRunning = lvl === runningLevel;
            return (
              <button
                key={lvl}
                onClick={() => handleSelect(lvl)}
                className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "hover:bg-bg-elevated text-text-secondary"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <EffortBars level={lvl} levels={levels} />
                  <span className="text-ui font-medium">{labelFor(lvl)}</span>
                </span>
                {isRunning && (
                  <span className="text-label text-text-dim">running</span>
                )}
              </button>
            );
          })}

          <div className="border-t border-border-light mt-1 pt-1">
            {restartTarget ? (
              <>
                <button
                  onClick={handleRestart}
                  disabled={!canRestart}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-ui font-medium transition-colors ${
                    canRestart
                      ? "text-accent hover:bg-accent/10"
                      : "text-text-ghost cursor-not-allowed"
                  }`}
                  title={
                    canRestart
                      ? `Close and reopen the session with --effort ${restartTarget}`
                      : sessionStreaming || sessionBusy
                        ? "Wait for the current turn to finish"
                        : ""
                  }
                >
                  <RefreshCw
                    size={12}
                    className={restarting ? "animate-spin" : ""}
                  />
                  <span>
                    {restarting
                      ? "Restarting…"
                      : `Apply ${labelFor(restartTarget)} now (restart session)`}
                  </span>
                </button>
                <div className="px-2.5 pb-1.5 text-label text-text-dim">
                  {(session?.agent_id ?? "claude_code") === "codex"
                    ? "Codex applies effort per turn — picking a level here just updates the next turn's request."
                    : "Claude Code has no runtime way to change effort, so applying it to the running session means closing and resuming the CLI process."}
                </div>
              </>
            ) : (
              <div className="px-2.5 py-1.5 text-label text-text-dim">
                {runningLevel
                  ? `Current session is running at ${labelFor(runningLevel)}.`
                  : "Applies the next time a session is started."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
