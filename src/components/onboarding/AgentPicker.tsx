import { useEffect, useState } from "react";

import type { AgentId } from "../../types/agent-events";
import { checkClaudeStatus } from "../../lib/tauri-commands";

/**
 * Provider picker — Phase 2 §5. Renders between the project picker and
 * the spawn call when more than one agent has a working binary on disk.
 *
 * Auto-collapses to a single static label when only one binary is
 * present (no point in showing a one-option radio); shows an inline
 * "install" hint for the missing agent. Selection persists locally via
 * an opaque store callback so the parent decides when to commit it.
 *
 * Codex's `auth ok` check is not done here on purpose — the spawn path
 * runs `codex login status` and surfaces `AgentError::AuthRequired`
 * with the docs link. The picker stays a pure presentation component;
 * it doesn't gate on auth state.
 */
export interface AgentPickerProps {
  /** Currently-selected agent id. */
  value: AgentId;
  /** Selection callback. */
  onChange: (next: AgentId) => void;
  /** Optional override for installed status, primarily for tests. */
  installed?: { claude_code: boolean; codex: boolean };
  /** Hide the picker entirely (user disabled via settings). */
  hidden?: boolean;
}

const AGENTS: { id: AgentId; label: string; tagline: string; installHint: string }[] = [
  {
    id: "claude_code",
    label: "Claude Code",
    tagline: "Anthropic's CLI — uses your Claude Pro/Max subscription.",
    installHint: "Install: npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    tagline: "ChatGPT-bundled coding agent — uses your ChatGPT subscription.",
    installHint: "Install: npm install -g @openai/codex && codex login",
  },
];

export default function AgentPicker({
  value,
  onChange,
  installed,
  hidden,
}: AgentPickerProps): React.ReactElement | null {
  const [autoInstalled, setAutoInstalled] = useState<{ claude_code: boolean; codex: boolean }>(
    () => installed ?? { claude_code: true, codex: false },
  );

  useEffect(() => {
    if (installed) return; // tests inject the status directly
    let cancelled = false;
    void (async () => {
      let claudeOk = false;
      try {
        const s = await checkClaudeStatus();
        claudeOk = !!s.installed;
      } catch {
        /* absence is fine */
      }
      // Codex install detection: Tauri command lands in S8 (binary_detect
      // exposed as is_codex_installed). For S6 the picker is purely
      // user-driven — the user picks Codex, the spawn surfaces an
      // actionable error if the binary is missing.
      if (!cancelled) {
        setAutoInstalled({ claude_code: claudeOk, codex: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [installed]);

  const status = installed ?? autoInstalled;
  const installedCount = (status.claude_code ? 1 : 0) + (status.codex ? 1 : 0);

  if (hidden) return null;
  if (installedCount === 0) return null; // welcome screen handles install guidance

  // Collapse to a static label when only one agent is available — no
  // point in showing a one-option radio.
  if (installedCount === 1) {
    const only = status.claude_code ? AGENTS[0] : AGENTS[1];
    const missing = status.claude_code ? AGENTS[1] : AGENTS[0];
    return (
      <div
        className="text-label text-text-ghost py-2"
        data-testid="agent-picker-collapsed"
      >
        Agent: <span className="text-text-secondary">{only.label}</span>
        <span className="ml-2 text-text-ghost">
          · Add {missing.label}: {missing.installHint}
        </span>
      </div>
    );
  }

  return (
    <fieldset
      className="border border-border rounded-lg p-3 mb-3"
      data-testid="agent-picker"
    >
      <legend className="text-label text-text-secondary px-2">Agent</legend>
      <div className="flex flex-col gap-2">
        {AGENTS.map((a) => (
          <label
            key={a.id}
            className={`flex items-start gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
              value === a.id
                ? "bg-accent-dim border border-accent"
                : "border border-transparent hover:bg-bg-elevated"
            }`}
          >
            <input
              type="radio"
              name="agent-picker"
              value={a.id}
              checked={value === a.id}
              onChange={() => onChange(a.id)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-ui text-text-primary">{a.label}</div>
              <div className="text-label text-text-ghost">{a.tagline}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
