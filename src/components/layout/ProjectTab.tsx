import React, { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";

interface ProjectTabProps {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

interface ProjectBusyStatus {
  /** Number of sessions in the project currently running a job. */
  busyCount: number;
  /** A busy session has made no progress for >30s. */
  stale: boolean;
  /** A session is stuck or awaiting a tool approval — needs the user. */
  attention: boolean;
}

/** Aggregates the live work state of a project's sessions for the tab
 *  indicator: how many are busy, whether any are stalled, and whether any
 *  need attention (stuck / awaiting approval). Selectors return primitives
 *  to avoid Zustand snapshot churn. */
function useProjectBusyStatus(projectPath: string): ProjectBusyStatus {
  const busyCount = useSessionStore((s) => {
    let n = 0;
    for (const id of s.tabOrder) {
      const session = s.sessions.get(id);
      if (session && session.project_path === projectPath && s.sessionBusy.get(id)) n++;
    }
    return n;
  });
  const stale = useSessionStore((s) => {
    for (const id of s.tabOrder) {
      const session = s.sessions.get(id);
      if (
        session &&
        session.project_path === projectPath &&
        s.sessionBusy.get(id) &&
        Date.now() - (s.lastEventTimestamp.get(id) ?? 0) > 30_000
      ) {
        return true;
      }
    }
    return false;
  });
  const stuck = useSessionStore((s) => {
    for (const id of s.tabOrder) {
      const session = s.sessions.get(id);
      if (session && session.project_path === projectPath && s.sessionStuck.get(id)) return true;
    }
    return false;
  });
  const awaitingApproval = useActivityStore((s) =>
    s.approvalQueue.some((a) => {
      const session = useSessionStore.getState().sessions.get(a.sessionId);
      return session?.project_path === projectPath;
    }),
  );
  return { busyCount, stale, attention: stuck || awaitingApproval };
}

export default React.memo(function ProjectTab({
  projectPath,
  projectName,
  sessionCount,
  isActive,
  onSelect,
  onClose,
}: ProjectTabProps) {
  const [hovered, setHovered] = useState(false);
  const { busyCount, stale, attention } = useProjectBusyStatus(projectPath);
  const busy = busyCount > 0;

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={projectName}
      className={`
        relative flex items-center gap-1.5 px-3 h-full cursor-pointer select-none
        min-w-[100px] max-w-[180px] shrink-0
        transition-colors border-r border-border-light
        ${
          isActive
            ? "bg-bg-elevated border-t-2 border-t-accent"
            : "hover:bg-bg-subtle border-t-2 border-t-transparent"
        }
      `}
    >
      {/* Status dot — green pulse when working, yellow when stalled or a
          session needs attention (stuck / awaiting approval). */}
      {busy && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            attention || stale ? "bg-yellow-400" : "bg-green-400 animate-pulse"
          }`}
        />
      )}

      {/* Folder icon */}
      {!busy && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-dim shrink-0"
        >
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      )}

      {/* Name + session count */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <span className="text-ui text-text-primary font-medium block truncate">
          {projectName}
        </span>
      </div>

      {/* Badge — when working, show how many sessions are active (colored);
          otherwise fall back to the total session count. */}
      {busy ? (
        <span
          className="text-label font-medium rounded px-1 shrink-0"
          style={{
            color: attention || stale ? "var(--yellow)" : "var(--green)",
            background: "var(--bg-subtle)",
          }}
          title={`${busyCount} session${busyCount === 1 ? "" : "s"} working`}
        >
          {busyCount}
        </span>
      ) : (
        sessionCount > 1 && (
          <span className="text-label text-text-ghost bg-bg-subtle rounded px-1 shrink-0">
            {sessionCount}
          </span>
        )
      )}

      {/* Close button */}
      {(hovered || isActive) && (
        <button
          onClick={handleCloseClick}
          aria-label={`Close ${projectName}`}
          className="p-0.5 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors shrink-0"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
})
