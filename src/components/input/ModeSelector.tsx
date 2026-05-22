import { useState } from "react";
import { Shield, ShieldCheck, ShieldAlert, Map, Sparkles, Zap } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { setSessionMode as setSessionModeCmd } from "../../lib/tauri-commands";
import { useClickOutside } from "../../hooks/useClickOutside";
import type { SessionMode } from "../../types/session";

const MODES: { id: SessionMode; label: string; description: string; icon: typeof Shield }[] = [
  {
    id: "normal",
    label: "Normal",
    description: "Ask permission before edits",
    icon: Shield,
  },
  {
    id: "auto-accept",
    label: "Auto-Accept",
    description: "Accept all tool calls automatically",
    icon: ShieldCheck,
  },
  {
    id: "plan",
    label: "Plan",
    description: "Plan only, no code changes",
    icon: Map,
  },
  {
    id: "auto",
    label: "Auto",
    description: "CLI decides per tool (auto-routing)",
    icon: Sparkles,
  },
  {
    id: "dont-ask",
    label: "Don't Ask",
    description: "Accept everything, no prompts",
    icon: Zap,
  },
  {
    id: "bypass-permissions",
    label: "Bypass",
    description: "Skip all permission checks (dangerous)",
    icon: ShieldAlert,
  },
];

const MODE_COLOR: Record<SessionMode, string> = {
  "normal": "text-text-faint",
  "auto-accept": "text-green",
  "plan": "text-yellow",
  "auto": "text-blue",
  "dont-ask": "text-green",
  "bypass-permissions": "text-red",
  // Codex-only mode — ModeSelector is only mounted for Claude sessions
  // (Codex sessions render PolicyPill instead), so this entry should
  // never actually be displayed. Present to satisfy the Record<…>
  // exhaustiveness check; matches the review banner's accent colour.
  "review": "text-accent",
};

export default function ModeSelector() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionModes = useSessionStore((s) => s.sessionModes);
  const setSessionMode = useSessionStore((s) => s.setSessionMode);

  const mode = activeSessionId
    ? sessionModes.get(activeSessionId) ?? "normal"
    : "normal";

  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const Icon = current.icon;

  const modeColor = MODE_COLOR[mode] ?? "text-text-faint";

  const handleModeChange = (newMode: SessionMode) => {
    if (!activeSessionId) return;
    // Update frontend state
    setSessionMode(activeSessionId, newMode);
    // Send to Rust backend — enforced at the approval server level
    setSessionModeCmd(activeSessionId, newMode).catch((e) =>
      console.error("Failed to set session mode:", e)
    );
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!activeSessionId}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-label hover:bg-bg-subtle transition-colors ${modeColor}`}
        title={`Mode: ${current.label}`}
      >
        <Icon size={13} />
        <span>{current.label}</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1.5 w-[220px] rounded-lg border border-border p-1 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          {MODES.map((m) => {
            const MIcon = m.icon;
            const isActive = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id)}
                className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "hover:bg-bg-elevated text-text-secondary"
                }`}
              >
                <MIcon size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-ui font-medium">{m.label}</div>
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
