import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useCliModelCacheStore } from "../../stores/cliModelCacheStore";
import { setSessionModel } from "../../lib/tauri-commands";
import { formatModelName } from "../../lib/format-utils";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { CliModelInfo } from "../../types/agent-events";
import { CODEX_FALLBACK_MODELS } from "../../lib/codex-models";
// Claude fallback (used while live `initialize`/`model/list` discovery is
// in-flight) lives in the shared resolver so the Duo setup modal reuses it.
import { CLAUDE_FALLBACK_MODELS } from "../../lib/agent-model-options";

export default function ModelSelector() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionCapabilities = useSessionStore((s) => s.sessionCapabilities);
  // Subscribe to the per-agent last-known-good model cache so we re-render
  // when any session populates it.
  const cachedModelsByAgent = useCliModelCacheStore((s) => s.models);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const caps = activeSessionId ? sessionCapabilities.get(activeSessionId) : undefined;
  const agent = session?.agent_id ?? "claude_code";
  // Agent-aware fallback: Codex sessions must never see Claude models
  // (Sonnet/Opus/Haiku) — that's user-visibly wrong even for the brief
  // pre-CapabilitiesDiscovered window. Pick the correct static list
  // based on the session's agent, then let the live event override.
  const agentFallback =
    agent === "codex" ? CODEX_FALLBACK_MODELS : CLAUDE_FALLBACK_MODELS;
  // Resolution order: live per-session caps → per-agent last-known-good
  // cache → hardcoded fallback. The cache holds the *detailed* live list
  // any prior session of this agent already produced, so a session that
  // momentarily lost its caps (after `/clear`, a resume/respawn, or an
  // app restart within the run) still shows the real models instead of
  // the reduced hardcoded list. Hardcoded fallback is the cold-start net.
  const cachedModels = cachedModelsByAgent[agent];
  const models: CliModelInfo[] =
    caps?.models && Array.isArray(caps.models) && caps.models.length > 0
      ? caps.models
      : cachedModels && cachedModels.length > 0
        ? cachedModels
        : agentFallback;

  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  // Resolved-default: when `session.model` is still null (fresh session,
  // user hasn't picked anything), show what the CLI would actually use —
  // gpt-5.5 for Codex, "Default" for Claude. Without this the label
  // would say "Model ▼" indefinitely for Codex sessions because
  // session.model is never auto-set on spawn.
  const resolvedDefault =
    models.find((m) => m.isDefault)?.value ?? models[0]?.value;
  const currentModelName =
    formatModelName(session?.model ?? resolvedDefault) ?? "Model";

  const handleSelect = (model: CliModelInfo) => {
    if (!activeSessionId) return;
    setSessionModel(activeSessionId, model.value).catch((e) =>
      console.error("Failed to set model:", e)
    );
    setOpen(false);
  };

  if (!session) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!activeSessionId}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-subtle transition-colors"
        title="Switch model"
      >
        <span>{currentModelName}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-1.5 w-[240px] rounded-lg border border-border p-1 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          {models.map((m) => {
            // Active = explicit user pick matches, OR no pick yet and this
            // is the resolved default (so the highlight matches the label).
            const isActive = session?.model
              ? session.model.includes(m.value) ||
                formatModelName(session.model) === m.displayName
              : m.value === resolvedDefault;
            return (
              <button
                key={m.value}
                onClick={() => handleSelect(m)}
                className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "hover:bg-bg-elevated text-text-secondary"
                }`}
              >
                <div>
                  <div className="text-ui font-medium">{m.displayName}</div>
                  <div className="text-label text-text-dim">{m.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
