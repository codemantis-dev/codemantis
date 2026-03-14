import { AI_PROVIDERS, AI_MODELS } from "../../types/assistant-provider";
import type { AIProvider, APIProvider } from "../../types/assistant-provider";

interface AssistantProviderMenuProps {
  apiKeys: Record<string, string>;
  expandedProvider: string | null;
  creating: boolean;
  onExpandProvider: (providerId: string | null) => void;
  onCreate: (provider: AIProvider, model?: string) => void;
  /** "empty" = full-page empty state list; "popover" = floating dropdown menu */
  variant: "empty" | "popover";
  menuRef?: React.RefObject<HTMLDivElement | null>;
}

export default function AssistantProviderMenu({
  apiKeys,
  expandedProvider,
  creating,
  onExpandProvider,
  onCreate,
  variant,
  menuRef,
}: AssistantProviderMenuProps) {
  if (variant === "popover") {
    return (
      <div
        ref={menuRef}
        className="absolute top-8 right-1 z-20 rounded-lg border shadow-lg py-1 min-w-[180px]"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        {AI_PROVIDERS.map((p) => {
          const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
          const isApi = p.id !== "claude-code";
          const models = isApi ? (AI_MODELS[p.id as APIProvider] ?? []) : [];
          const isExpanded = expandedProvider === p.id;
          return (
            <div key={p.id}>
              <button
                onClick={() => {
                  if (!hasKey || creating) return;
                  if (isApi && models.length > 0) {
                    onExpandProvider(isExpanded ? null : p.id);
                  } else {
                    onCreate(p.id);
                  }
                }}
                disabled={creating || !hasKey}
                className="w-full text-left px-3 py-1.5 text-ui hover:bg-bg-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
              >
                <span className="text-text-primary">{p.label}</span>
                {!hasKey ? (
                  <span className="text-[9px] text-text-ghost">No key</span>
                ) : isApi && models.length > 0 ? (
                  <span className="text-[9px] text-text-ghost">{isExpanded ? "\u25B4" : "\u25BE"}</span>
                ) : null}
              </button>
              {isExpanded && models.length > 0 && (
                <div className="border-t border-border-light" style={{ background: "var(--bg-elevated)" }}>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onCreate(p.id, m.id)}
                      disabled={creating}
                      className="w-full text-left pl-6 pr-3 py-1.5 text-label hover:bg-bg-subtle transition-colors disabled:opacity-40"
                    >
                      <span className="text-text-secondary">{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // variant === "empty" — full-page empty state provider list
  return (
    <div className="flex flex-col gap-1.5 w-full max-w-[240px]">
      {AI_PROVIDERS.map((p) => {
        const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
        const isApi = p.id !== "claude-code";
        const models = isApi ? (AI_MODELS[p.id as APIProvider] ?? []) : [];
        const isExpanded = expandedProvider === p.id;
        return (
          <div key={p.id}>
            <button
              onClick={() => {
                if (!hasKey || creating) return;
                if (isApi && models.length > 0) {
                  onExpandProvider(isExpanded ? null : p.id);
                } else {
                  onCreate(p.id);
                }
              }}
              disabled={creating || !hasKey}
              className="w-full px-3 py-2 rounded-lg text-ui text-left transition-colors border border-border-light hover:border-accent/30 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
              title={!hasKey ? `Set API key in Settings > AI Providers` : `New ${p.label} assistant`}
            >
              <span className="text-text-primary">{p.label}</span>
              {!hasKey ? (
                <span className="text-[10px] text-text-ghost">No API key</span>
              ) : isApi && models.length > 0 ? (
                <span className="text-[10px] text-text-ghost">{isExpanded ? "\u25B4" : "\u25BE"}</span>
              ) : null}
            </button>
            {isExpanded && models.length > 0 && (
              <div className="ml-3 mt-1 space-y-0.5">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onCreate(p.id, m.id)}
                    disabled={creating}
                    className="w-full px-3 py-1.5 rounded-md text-label text-left text-text-secondary hover:bg-accent/5 hover:text-text-primary transition-colors disabled:opacity-40"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
