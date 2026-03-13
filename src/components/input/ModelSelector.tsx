import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { setSessionModel } from "../../lib/tauri-commands";
import { formatModelName } from "../../lib/format-utils";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { CliModelInfo } from "../../types/claude-events";

const FALLBACK_MODELS: CliModelInfo[] = [
  { value: "default", displayName: "Default", description: "Account default" },
  { value: "sonnet", displayName: "Sonnet", description: "Fast and capable" },
  { value: "opus[1m]", displayName: "Opus (1M)", description: "Extended context" },
  { value: "sonnet[1m]", displayName: "Sonnet (1M)", description: "Extended context" },
  { value: "haiku", displayName: "Haiku", description: "Fastest" },
];

export default function ModelSelector() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionCapabilities = useSessionStore((s) => s.sessionCapabilities);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const caps = activeSessionId ? sessionCapabilities.get(activeSessionId) : undefined;
  const models: CliModelInfo[] =
    caps?.models && Array.isArray(caps.models) && caps.models.length > 0
      ? caps.models
      : FALLBACK_MODELS;

  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const currentModelName = formatModelName(session?.model) ?? "Model";

  const handleSelect = (model: CliModelInfo) => {
    if (!activeSessionId) return;
    setSessionModel(activeSessionId, model.value).catch((e) =>
      console.error("Failed to set model:", e)
    );
    setOpen(false);
  };

  if (!session) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!activeSessionId}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-subtle transition-colors"
        title="Switch model"
      >
        <span>{currentModelName}</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-1.5 w-[240px] rounded-lg border border-border p-1 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          {models.map((m) => {
            const isActive =
              session?.model?.includes(m.value) ||
              formatModelName(session?.model) === m.displayName;
            return (
              <button
                key={m.value}
                onClick={() => handleSelect(m)}
                className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "hover:bg-bg-elevated text-text-secondary"
                }`}
              >
                <div>
                  <div className="text-ui font-medium">{m.displayName}</div>
                  <div className="text-label text-text-dim">{m.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
