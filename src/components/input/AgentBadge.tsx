import { useEffect, useRef, useState } from "react";

import type { AgentId } from "../../types/agent-events";
import { checkClaudeStatus } from "../../lib/tauri-commands";
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

  // Probe Claude installation lazily so the popover can show accurate
  // status. Codex auto-check IPC lands in v1.4.0; until then we assume
  // the user has installed whichever agent is on their PATH.
  useEffect(() => {
    if (claudeInstalled !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await checkClaudeStatus();
        if (!cancelled) setClaudeInstalled(!!s.installed);
      } catch {
        if (!cancelled) setClaudeInstalled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claudeInstalled]);

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
          className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-bg shadow-lg p-3 z-50"
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
          {otherAgent === "codex" && (
            <div className="mt-2 text-label text-text-ghost">
              If <code className="px-1 py-0.5 rounded bg-bg-elevated">codex</code>{" "}
              isn't installed yet:{" "}
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
