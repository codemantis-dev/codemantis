import { Wrench } from "lucide-react";
import {
  MCP_TEMPLATES,
  MCP_TEMPLATE_CATEGORIES,
  type McpTemplate,
} from "../../../types/mcp-templates";

export default function TemplatePicker({
  onSelect,
  onManual,
}: {
  onSelect: (template: McpTemplate) => void;
  onManual: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      <p className="text-ui text-text-dim">
        Choose a template or configure manually
      </p>

      {MCP_TEMPLATE_CATEGORIES.map((cat) => {
        const templates = MCP_TEMPLATES.filter((t) => t.category === cat.id);
        return (
          <div key={cat.id}>
            <h4 className="text-label font-semibold text-text-dim uppercase tracking-wider mb-2">
              {cat.label}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-accent/40 hover:bg-accent/5 transition-colors text-left group"
                >
                  <span className="text-lg leading-none mt-0.5">{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ui font-medium text-text-primary group-hover:text-accent transition-colors">
                        {t.displayName}
                      </span>
                      {cat.id === "api-key" && (
                        <span className="text-detail text-text-ghost">🔑</span>
                      )}
                      {cat.id === "cloud" && (
                        <span className="text-detail text-text-ghost">☁</span>
                      )}
                    </div>
                    <p className="text-label text-text-dim mt-0.5 truncate">
                      {t.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Manual Configuration */}
      <button
        onClick={onManual}
        className="w-full flex items-center gap-2.5 p-3 rounded-lg border border-dashed border-border hover:border-text-dim hover:bg-bg-elevated transition-colors text-left"
      >
        <Wrench size={16} className="text-text-dim shrink-0" />
        <div>
          <span className="text-ui font-medium text-text-secondary">
            Manual Configuration
          </span>
          <p className="text-label text-text-dim mt-0.5">
            Start with a blank form
          </p>
        </div>
      </button>

    </div>
  );
}
