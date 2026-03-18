import React, { useState, useRef, useCallback } from "react";
import { Plus, X, ScrollText, History } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import StatusDot from "../shared/StatusDot";

interface SessionSubTabProps {
  sessionId: string;
  name: string;
  model: string | null;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

const SessionSubTab = React.memo(function SessionSubTab({
  name,
  model,
  isActive,
  isStreaming,
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
      {/* Status dot */}
      <StatusDot
        color={isStreaming ? "yellow" : "green"}
        pulse={isStreaming}
        size={4}
      />

      {/* Model badge */}
      {capitalizedModel && (
        <span className="text-[10px] font-medium text-accent bg-accent-dim rounded px-1 py-px shrink-0">
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
  onAddSession: () => void;
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
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);
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
        const streaming = sessionStreaming.get(sessionId);
        return (
          <SessionSubTab
            key={sessionId}
            sessionId={sessionId}
            name={session.name}
            model={session.model}
            isActive={sessionId === activeSessionId && !showProjectLog && !showClaudeHistory}
            isStreaming={streaming?.isStreaming ?? false}
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

      {/* Add session button */}
      <button
        onClick={() => onAddSession()}
        title="New session in this project"
        className="mx-1 p-1 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors shrink-0"
      >
        <Plus size={13} />
      </button>

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
        <span>History</span>
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
