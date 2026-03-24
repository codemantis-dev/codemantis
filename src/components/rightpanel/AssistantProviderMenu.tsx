import { useState, useMemo } from "react";
import { AI_PROVIDERS, AI_MODELS } from "../../types/assistant-provider";
import type { AIProvider, APIProvider } from "../../types/assistant-provider";
import { useOpenRouterStore } from "../../stores/openRouterStore";
import ModelCapabilityBadges from "../shared/ModelCapabilityBadges";

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

function OpenRouterModelPicker({
  creating,
  onCreate,
  variant,
}: {
  creating: boolean;
  onCreate: (provider: AIProvider, model?: string) => void;
  variant: "empty" | "popover";
}) {
  const [search, setSearch] = useState("");
  const orModels = useOpenRouterStore((s) => s.models);
  const loading = useOpenRouterStore((s) => s.loading);

  const filtered = useMemo(() => {
    if (!search.trim()) return orModels;
    const q = search.toLowerCase();
    return orModels.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [orModels, search]);

  const freeModels = useMemo(() => filtered.filter((m) => m.isFree), [filtered]);
  const paidModels = useMemo(() => filtered.filter((m) => !m.isFree), [filtered]);

  if (loading) {
    return (
      <div className="px-3 py-2 text-label text-text-ghost">Loading models...</div>
    );
  }

  if (orModels.length === 0) {
    return (
      <div className="px-3 py-2 text-label text-text-ghost">
        No models loaded. Test your API key in Settings first.
      </div>
    );
  }

  const isPopover = variant === "popover";
  const itemClass = isPopover
    ? "w-full text-left pl-6 pr-3 py-1.5 text-label hover:bg-bg-subtle transition-colors disabled:opacity-40 flex items-center justify-between gap-2"
    : "w-full px-3 py-1.5 rounded-md text-label text-left text-text-secondary hover:bg-accent/5 hover:text-text-primary transition-colors disabled:opacity-40 flex items-center justify-between gap-2";

  return (
    <div>
      <div className={isPopover ? "px-3 py-1.5" : "px-1 py-1"}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models..."
          autoFocus
          className="w-full px-2 py-1 rounded text-label bg-bg-elevated border border-border text-text-primary outline-none focus:border-accent/40 placeholder:text-text-ghost"
        />
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {freeModels.length > 0 && (
          <>
            <div className="px-3 py-1 text-[9px] text-text-ghost uppercase tracking-wider">
              Free ({freeModels.length})
            </div>
            {freeModels.map((m) => (
              <button
                key={m.id}
                onClick={() => onCreate("openrouter", m.id)}
                disabled={creating}
                className={itemClass}
                title={m.id}
              >
                <span className="text-text-secondary truncate">{m.name}</span>
                <ModelCapabilityBadges model={m} />
              </button>
            ))}
          </>
        )}
        {paidModels.length > 0 && (
          <>
            <div className="px-3 py-1 text-[9px] text-text-ghost uppercase tracking-wider mt-1">
              Paid ({paidModels.length})
            </div>
            {paidModels.map((m) => (
              <button
                key={m.id}
                onClick={() => onCreate("openrouter", m.id)}
                disabled={creating}
                className={itemClass}
                title={m.id}
              >
                <span className="text-text-secondary truncate">{m.name}</span>
                <ModelCapabilityBadges model={m} />
              </button>
            ))}
          </>
        )}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-label text-text-ghost">No models match "{search}"</div>
        )}
      </div>
    </div>
  );
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
        className="absolute top-8 right-1 z-20 rounded-lg border shadow-lg py-1 min-w-[280px]"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        {AI_PROVIDERS.map((p) => {
          const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
          const isApi = p.id !== "claude-code";
          const isOpenRouter = p.id === "openrouter";
          const models = isApi && !isOpenRouter ? (AI_MODELS[p.id as APIProvider] ?? []) : [];
          const isExpanded = expandedProvider === p.id;
          return (
            <div key={p.id}>
              <button
                onClick={() => {
                  if (!hasKey || creating) return;
                  if (isOpenRouter || (isApi && models.length > 0)) {
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
                ) : (isApi && (models.length > 0 || isOpenRouter)) ? (
                  <span className="text-[9px] text-text-ghost">{isExpanded ? "\u25B4" : "\u25BE"}</span>
                ) : null}
              </button>
              {isExpanded && isOpenRouter && (
                <div className="border-t border-border-light" style={{ background: "var(--bg-elevated)" }}>
                  <OpenRouterModelPicker creating={creating} onCreate={onCreate} variant="popover" />
                </div>
              )}
              {isExpanded && !isOpenRouter && models.length > 0 && (
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
    <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
      {AI_PROVIDERS.map((p) => {
        const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
        const isApi = p.id !== "claude-code";
        const isOpenRouter = p.id === "openrouter";
        const models = isApi && !isOpenRouter ? (AI_MODELS[p.id as APIProvider] ?? []) : [];
        const isExpanded = expandedProvider === p.id;
        return (
          <div key={p.id}>
            <button
              onClick={() => {
                if (!hasKey || creating) return;
                if (isOpenRouter || (isApi && models.length > 0)) {
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
              ) : (isApi && (models.length > 0 || isOpenRouter)) ? (
                <span className="text-[10px] text-text-ghost">{isExpanded ? "\u25B4" : "\u25BE"}</span>
              ) : null}
            </button>
            {isExpanded && isOpenRouter && (
              <div className="ml-3 mt-1">
                <OpenRouterModelPicker creating={creating} onCreate={onCreate} variant="empty" />
              </div>
            )}
            {isExpanded && !isOpenRouter && models.length > 0 && (
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
