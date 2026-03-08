import { Plus, X } from "lucide-react";
import type { TerminalInstance } from "../../types/terminal";
import StatusDot from "../shared/StatusDot";

interface TerminalTabsProps {
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export default function TerminalTabs({
  terminals,
  activeTerminalId,
  onSelect,
  onClose,
  onCreate,
}: TerminalTabsProps) {
  return (
    <div className="flex items-center h-7 border-b border-border-light px-1 gap-0.5 shrink-0">
      {terminals.map((terminal) => (
        <button
          key={terminal.id}
          onClick={() => onSelect(terminal.id)}
          className={`
            flex items-center gap-1 px-2 h-6 rounded text-label transition-colors group
            ${
              terminal.id === activeTerminalId
                ? "bg-bg-elevated text-text-primary"
                : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle"
            }
          `}
        >
          <StatusDot
            color={terminal.isRunning ? "green" : "red"}
            size={4}
          />
          <span className="truncate max-w-[80px]">{terminal.name}</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onClose(terminal.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-subtle transition-all"
          >
            <X size={10} />
          </span>
        </button>
      ))}
      <button
        onClick={onCreate}
        className="flex items-center justify-center w-6 h-6 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors"
        title="New terminal"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
