import { Plus, X } from "lucide-react";
import type { AssistantInstance } from "../../stores/assistantStore";
import StatusDot from "../shared/StatusDot";

interface AssistantTabsProps {
  assistants: AssistantInstance[];
  activeAssistantId: string | null;
  busyMap: Map<string, boolean>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export default function AssistantTabs({
  assistants,
  activeAssistantId,
  busyMap,
  onSelect,
  onClose,
  onCreate,
}: AssistantTabsProps) {
  return (
    <div className="flex items-center h-7 border-b border-border-light px-1 gap-0.5 shrink-0">
      {assistants.map((asst) => {
        const isBusy = busyMap.get(asst.id) ?? false;
        return (
          <button
            key={asst.id}
            onClick={() => onSelect(asst.id)}
            className={`
              flex items-center gap-1 px-2 h-6 rounded text-label transition-colors group
              ${
                asst.id === activeAssistantId
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-dim hover:text-text-secondary hover:bg-bg-subtle"
              }
            `}
          >
            <StatusDot
              color={isBusy ? "yellow" : "green"}
              size={4}
            />
            <span className="truncate max-w-[80px]" title={asst.name}>{asst.name}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onClose(asst.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-subtle transition-all"
              title="Close assistant"
            >
              <X size={10} />
            </span>
          </button>
        );
      })}
      <button
        onClick={onCreate}
        className="flex items-center justify-center w-6 h-6 rounded text-text-ghost hover:text-text-secondary hover:bg-bg-subtle transition-colors"
        title="New assistant"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
