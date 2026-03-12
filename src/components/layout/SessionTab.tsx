import { useState, useRef, useCallback } from "react";
import { X } from "lucide-react";
import StatusDot from "../shared/StatusDot";

const SESSION_ICONS = ["⬡", "◈", "△", "○", "□", "◇", "⬢", "▽", "◎", "⬟"];

interface SessionTabProps {
  id: string;
  name: string;
  projectName: string;
  iconIndex: number;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

export default function SessionTab({
  name,
  projectName,
  iconIndex,
  isActive,
  isStreaming,
  onSelect,
  onClose,
  onRename,
}: SessionTabProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const icon = SESSION_ICONS[iconIndex % SESSION_ICONS.length];

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
        relative flex items-center gap-1.5 px-3 h-full cursor-pointer select-none
        min-w-[120px] max-w-[200px] shrink-0
        transition-colors border-r border-border-light
        ${
          isActive
            ? "bg-bg-elevated border-t-2 border-t-accent"
            : "hover:bg-bg-subtle border-t-2 border-t-transparent"
        }
      `}
    >
      {/* Icon */}
      <span className="text-text-dim text-xs shrink-0">{icon}</span>

      {/* Status dot */}
      <StatusDot
        color={isStreaming ? "yellow" : "green"}
        pulse={isStreaming}
        size={5}
      />

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
          className="flex-1 min-w-0 bg-transparent text-ui text-text-primary outline-none border-b border-accent"
          autoFocus
        />
      ) : (
        <div className="flex-1 min-w-0 overflow-hidden">
          <span className="text-ui text-text-primary font-medium block truncate">
            {name}
          </span>
          {projectName !== name && (
            <span className="text-label text-text-ghost block truncate leading-none">
              {projectName}
            </span>
          )}
        </div>
      )}

      {/* Close button */}
      {(hovered || isActive) && !editing && (
        <button
          onClick={handleCloseClick}
          aria-label={`Close ${name}`}
          className="p-0.5 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors shrink-0"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
