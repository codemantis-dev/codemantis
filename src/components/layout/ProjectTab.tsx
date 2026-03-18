import React, { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";

interface ProjectTabProps {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** Returns "busy" | "stale" | "idle" for a project's sessions. */
function useProjectBusyStatus(projectPath: string): "busy" | "stale" | "idle" {
  return useSessionStore((s) => {
    let anyBusy = false;
    let anyStale = false;
    for (const id of s.tabOrder) {
      const session = s.sessions.get(id);
      if (!session || session.project_path !== projectPath) continue;
      if (s.sessionBusy.get(id)) {
        anyBusy = true;
        if (Date.now() - (s.lastEventTimestamp.get(id) ?? 0) > 30_000) anyStale = true;
      }
    }
    return anyStale ? "stale" : anyBusy ? "busy" : "idle";
  });
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
  const busyStatus = useProjectBusyStatus(projectPath);

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
      {/* Status dot */}
      {busyStatus !== "idle" && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            busyStatus === "busy"
              ? "bg-green-400 animate-pulse"
              : "bg-yellow-400"
          }`}
        />
      )}

      {/* Folder icon */}
      {busyStatus === "idle" && (
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

      {/* Session count badge */}
      {sessionCount > 1 && (
        <span className="text-label text-text-ghost bg-bg-subtle rounded px-1 shrink-0">
          {sessionCount}
        </span>
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
