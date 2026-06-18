import React, { useState, useRef, useCallback, useEffect } from "react";
import { Plus, X, ScrollText, History } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import StatusDot from "../shared/StatusDot";
import Portal from "../shared/Portal";
import type { AgentId } from "../../types/agent-events";

const AGENT_LABEL: Record<AgentId, string> = {
  claude_code: "Claude Code",
  codex: "OpenAI Codex",
};

// Display order in the agent picker menu.
const AGENT_ORDER: AgentId[] = ["claude_code", "codex"];

/**
 * The "+" new-session control. When BOTH coding agents are installed it
 * opens a small menu so the user can pick which agent the next session
 * runs on (sessions are locked to their agent for life — spec §3.4). When
 * only one (or neither) agent is installed the per-task resolver already
 * has just one viable choice, so we keep the original one-click behaviour.
 */
function AddSessionButton({
  onAddSession,
}: {
  onAddSession: (agentOverride?: AgentId) => void;
}) {
  const agentInstall = useUiStore((s) => s.agentInstall);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const bothInstalled = agentInstall.claude_code && agentInstall.codex;

  // The menu is portaled to <body> so it escapes the tab strip's
  // `overflow-x-auto overflow-y-hidden` clip (which previously hid it
  // entirely). Anchor it to the trigger's rect and open downward — the
  // strip sits near the top of the window.
  const toggleOpen = useCallback((): void => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ left: rect.left, top: rect.bottom + 4 });
    }
    setOpen((v) => !v);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!bothInstalled) {
    return (
      <button
        onClick={() => onAddSession()}
        title="New session in this project"
        className="mx-1 p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors shrink-0"
      >
        <Plus size={13} />
      </button>
    );
  }

  const pick = (agent: AgentId): void => {
    setOpen(false);
    // Persist the choice so subsequent default new-session flows (keyboard
    // shortcut, AgentBadge) reuse it until the user picks differently.
    setSelectedAgentId(agent);
    onAddSession(agent);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={toggleOpen}
        title="New session — choose agent"
        aria-haspopup="menu"
        aria-expanded={open}
        className="mx-1 p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Plus size={13} />
      </button>

      {open && (
        <Portal>
          <div
            ref={menuRef}
            role="menu"
            aria-label="New session agent"
            className="fixed w-52 rounded-lg border border-border p-1 shadow-xl z-50"
            style={{ background: "var(--bg-primary)", left: position.left, top: position.top }}
          >
            <div className="px-2 py-1 text-detail text-text-ghost select-none">
              New session with…
            </div>
            {AGENT_ORDER.map((agent) => (
              <button
                key={agent}
                role="menuitem"
                onClick={() => pick(agent)}
                className="w-full flex items-center px-2.5 py-1.5 rounded-md text-left text-ui text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
              >
                {AGENT_LABEL[agent]}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
}

interface SessionSubTabProps {
  sessionId: string;
  name: string;
  model: string | null;
  isActive: boolean;
  isBusy: boolean;
  isStuck: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

const SessionSubTab = React.memo(function SessionSubTab({
  name,
  model,
  isActive,
  isBusy,
  isStuck,
  onSelect,
  onClose,
  onRename,
}: SessionSubTabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const modelLabel = model
    ? model.replace(/^claude-/, "").split("-")[0]
    : null;
  const capitalizedModel = modelLabel
    ? modelLabel.charAt(0).toUpperCase() + modelLabel.slice(1)
    : null;

  const handleDoubleClick = useCallback(() => {
    setEditValue(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [name]);

  const handleCommitRename = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
  }, [editValue, name, onRename]);

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return (
    <div
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={name}
      className={`
        relative flex items-center gap-1.5 px-2.5 h-full cursor-pointer select-none
        min-w-[80px] max-w-[180px] shrink-0 text-label
        transition-colors
        ${
          isActive
            ? "bg-bg-elevated text-text-primary border-b-2 border-b-accent"
            : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle border-b-2 border-b-transparent"
        }
      `}
    >
      {/* Status dot — green pulse while the session is running a job,
          yellow when the watchdog flags it as stuck, static green when idle. */}
      <StatusDot
        color={isStuck ? "yellow" : "green"}
        pulse={isBusy}
        size={4}
      />

      {/* Model badge */}
      {capitalizedModel && (
        <span className="text-detail font-medium text-accent bg-accent-dim rounded px-1 py-px shrink-0">
          {capitalizedModel}
        </span>
      )}

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCommitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 min-w-0 bg-transparent text-label text-text-primary outline-none border-b border-accent"
          autoFocus
        />
      ) : (
        <span className="truncate">{name}</span>
      )}

      {/* Close button */}
      {(hovered || isActive) && !editing && (
        <button
          onClick={handleCloseClick}
          aria-label={`Close ${name}`}
          className="p-0.5 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors shrink-0"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
});

interface SessionSubTabsProps {
  onAddSession: (agentOverride?: AgentId) => void;
  onCloseSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
}

export default function SessionSubTabs({
  onAddSession,
  onCloseSession,
  onRenameSession,
}: SessionSubTabsProps) {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionBusy = useSessionStore((s) => s.sessionBusy);
  const sessionStuck = useSessionStore((s) => s.sessionStuck);
  const setActiveSessionInProject = useSessionStore((s) => s.setActiveSessionInProject);
  const showProjectLog = useUiStore((s) => s.showProjectLog);
  const showClaudeHistory = useUiStore((s) => s.showClaudeHistory);
  const setShowProjectLog = useUiStore((s) => s.setShowProjectLog);
  const setShowClaudeHistory = useUiStore((s) => s.setShowClaudeHistory);

  if (!activeProjectPath) return null;

  const projectSessionIds = tabOrder.filter((id) => {
    const s = sessions.get(id);
    return s && s.project_path === activeProjectPath;
  });

  if (projectSessionIds.length === 0 && !activeProjectPath) return null;

  return (
    <div
      className="h-8 flex items-center border-b border-border-light shrink-0 overflow-x-auto overflow-y-hidden"
      style={{ background: "var(--bg-subtle)" }}
    >
      {projectSessionIds.map((sessionId) => {
        const session = sessions.get(sessionId);
        if (!session) return null;
        return (
          <SessionSubTab
            key={sessionId}
            sessionId={sessionId}
            name={session.name}
            model={session.model}
            isActive={sessionId === activeSessionId && !showProjectLog && !showClaudeHistory}
            isBusy={sessionBusy.get(sessionId) ?? false}
            isStuck={!!sessionStuck.get(sessionId)}
            onSelect={() => {
              setShowProjectLog(false);
              setShowClaudeHistory(false);
              setActiveSessionInProject(activeProjectPath, sessionId);
            }}
            onClose={() => onCloseSession(sessionId)}
            onRename={(name) => onRenameSession(sessionId, name)}
          />
        );
      })}

      {/* Add session button — opens an agent picker when both CLIs exist */}
      <AddSessionButton onAddSession={onAddSession} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Claude History tab */}
      <button
        onClick={() => setShowClaudeHistory(true)}
        title="Claude History — resume closed sessions"
        className={`
          flex items-center gap-1.5 px-2.5 h-full cursor-pointer select-none shrink-0 text-label
          transition-colors border-b-2
          ${
            showClaudeHistory
              ? "bg-bg-elevated text-text-primary border-b-accent"
              : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle border-b-transparent"
          }
        `}
      >
        <History size={12} />
        <span>Session History</span>
      </button>

      {/* Project Log tab */}
      <button
        onClick={() => setShowProjectLog(true)}
        title="Project Log — all changelog entries"
        className={`
          flex items-center gap-1.5 px-2.5 h-full cursor-pointer select-none shrink-0 text-label
          transition-colors border-b-2
          ${
            showProjectLog
              ? "bg-bg-elevated text-text-primary border-b-accent"
              : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle border-b-transparent"
          }
        `}
      >
        <ScrollText size={12} />
        <span>Project Log</span>
      </button>
    </div>
  );
}
