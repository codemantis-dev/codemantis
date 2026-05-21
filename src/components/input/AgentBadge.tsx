import { useEffect, useRef, useState } from "react";

import type { AgentId } from "../../types/agent-events";
import { checkClaudeStatus, checkCodexStatus } from "../../lib/tauri-commands";
import { useUiStore } from "../../stores/uiStore";

/**
 * Visible agent indicator in the input toolbar (v1.3.1). Shows the
 * active session's agent ("Claude Code" / "OpenAI Codex") so users
 * always know which adapter is driving the conversation, and offers a
 * one-click path to spawn a fresh session in the same project with the
 * *other* agent.
 *
 * The "switch" action is in-quotes because adapters are per-session —
 * a session is locked to its agent for its lifetime (spec §3.4). This
 * badge instead creates a *new* session in the active project with the
 * chosen agent, so the user can have a Claude tab and a Codex tab open
 * side by side on the same project.
 */
export interface AgentBadgeProps {
  /** Agent id of the active session. */
  activeAgent: AgentId;
  /** Click handler that spawns a new session with the given agent in
   * the active project. Wired in InputArea via useClaudeSession. */
  onOpenNewSessionWith: (next: AgentId) => Promise<void> | void;
}

const LABEL: Record<AgentId, string> = {
  claude_code: "Claude Code",
  codex: "OpenAI Codex",
};

export default function AgentBadge({
  activeAgent,
  onOpenNewSessionWith,
}: AgentBadgeProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | null>(null);
  const [codexInstalled, setCodexInstalled] = useState<boolean | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Probe both adapters when the popover first opens so the install
  // hint text reflects reality (v1.3.1 added the real `check_codex_status`
  // IPC).
  useEffect(() => {
    if (!open) return;
    if (claudeInstalled !== null && codexInstalled !== null) return;
    let cancelled = false;
    void (async () => {
      const [claudeOk, codexOk] = await Promise.all([
        checkClaudeStatus()
          .then((s) => !!s.installed)
          .catch(() => false),
        checkCodexStatus()
          .then((s) => !!s.installed)
          .catch(() => false),
      ]);
      if (!cancelled) {
        setClaudeInstalled(claudeOk);
        setCodexInstalled(codexOk);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, claudeInstalled, codexInstalled]);

  const otherAgent: AgentId =
    activeAgent === "claude_code" ? "codex" : "claude_code";

  const handleSpawnOther = async (): Promise<void> => {
    setOpen(false);
    // Persist user's preference so subsequent new-session flows also use
    // this agent by default until they change it.
    setSelectedAgentId(otherAgent);
    await onOpenNewSessionWith(otherAgent);
  };

  return (
    <div className="relative inline-block" data-testid="agent-badge">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-label px-2 py-1 rounded-md border border-border bg-bg-elevated text-text-secondary hover:border-accent/40"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="agent-badge-trigger"
        title="Active session agent — click to see options"
      >
        Agent:{" "}
        <span className="text-text-primary">{LABEL[activeAgent]}</span>
        <span className="ml-1">▾</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 mt-2 w-72 rounded-lg border border-border shadow-xl p-3 z-50"
          style={{ background: "var(--bg-primary)" }}
          role="dialog"
          aria-label="Agent options"
          data-testid="agent-badge-popover"
        >
          <div className="text-label text-text-secondary mb-2">
            This session is running on{" "}
            <span className="text-text-primary">{LABEL[activeAgent]}</span>.
            Agents are locked per-session; to use the other agent, open a
            fresh session in this project.
          </div>
          <button
            type="button"
            onClick={() => void handleSpawnOther()}
            className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-accent/40 hover:bg-bg-elevated text-ui text-text-primary"
            data-testid="agent-badge-spawn-other"
          >
            Open new session with {LABEL[otherAgent]}
          </button>
          {otherAgent === "claude_code" && claudeInstalled === false && (
            <div className="mt-2 text-label text-text-ghost">
              Claude Code isn't on PATH — install it first:{" "}
              <code className="px-1 py-0.5 rounded bg-bg-elevated">
                npm install -g @anthropic-ai/claude-code
              </code>
            </div>
          )}
          {otherAgent === "codex" && codexInstalled === false && (
            <div className="mt-2 text-label text-text-ghost">
              OpenAI Codex isn't on PATH — install it first:{" "}
              <code className="px-1 py-0.5 rounded bg-bg-elevated">
                npm install -g @openai/codex && codex login
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
