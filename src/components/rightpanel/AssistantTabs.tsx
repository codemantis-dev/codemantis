import { Plus, X } from "lucide-react";
import type { AssistantInstance, TokenUsage } from "../../stores/assistantStore";
import type { AIProvider } from "../../types/assistant-provider";
import { calculateCost } from "../../types/assistant-provider";
import { formatCost } from "../../lib/format-utils";
import { useSettingsStore } from "../../stores/settingsStore";
import StatusDot from "../shared/StatusDot";

const PROVIDER_BADGES: Record<AIProvider, { short: string; color: string }> = {
  "claude-code": { short: "CC", color: "var(--accent)" },
  openai: { short: "OA", color: "#10a37f" },
  gemini: { short: "G", color: "#4285f4" },
  anthropic: { short: "A", color: "#d4a574" },
  openrouter: { short: "OR", color: "#6366f1" },
};

interface AssistantTabsProps {
  assistants: AssistantInstance[];
  activeAssistantId: string | null;
  busyMap: Map<string, boolean>;
  costMap: Map<string, TokenUsage>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export default function AssistantTabs({
  assistants,
  activeAssistantId,
  busyMap,
  costMap,
  onSelect,
  onClose,
  onCreate,
}: AssistantTabsProps) {
  const modelPricing = useSettingsStore((s) => s.settings.modelPricing);

  const getAssistantCost = (usage: TokenUsage | undefined, model: string | null): string => {
    if (!usage || !model) return "";
    const cost = calculateCost(model, usage.inputTokens, usage.outputTokens, modelPricing);
    return formatCost(cost, "explicit").replace("$0", "");
  };

  return (
    <div className="flex items-center h-7 border-b border-border-light px-1 gap-0.5 shrink-0">
      {assistants.map((asst) => {
        const isBusy = busyMap.get(asst.id) ?? false;
        const badge = PROVIDER_BADGES[asst.provider];
        const costStr = getAssistantCost(costMap.get(asst.id), asst.model);
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
            <span
              className="text-[9px] font-bold px-1 rounded leading-none py-0.5"
              style={{ backgroundColor: badge.color + "20", color: badge.color }}
              title={asst.provider}
            >
              {badge.short}
            </span>
            <span className="truncate max-w-[60px]" title={asst.name}>{asst.name}</span>
            {costStr && (
              <span className="text-[9px] text-text-ghost">{costStr}</span>
            )}
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
