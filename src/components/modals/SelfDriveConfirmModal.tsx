// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Confirm Modal — shown before starting autonomous mode
// ═══════════════════════════════════════════════════════════════════════

import * as Dialog from "@radix-ui/react-dialog";
import { X, Rocket } from "lucide-react";
import { useGuideStore } from "../../stores/guideStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { getModelLabel } from "../../types/assistant-provider";
import type { APIProvider } from "../../types/assistant-provider";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function SelfDriveConfirmModal({ open, onClose, onConfirm }: Props) {
  const guide = useGuideStore((s) => s.guide);
  const settings = useSettingsStore((s) => s.settings);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const currentMode = useSessionStore((s) =>
    s.activeSessionId ? s.sessionModes.get(s.activeSessionId) ?? "normal" : "normal",
  );

  if (!guide) return null;

  const remainingSessions = guide.sessions.filter((s) => s.status !== "done").length;
  const provider = settings.selfDriveProvider ?? "anthropic";
  const model = settings.selfDriveModel ?? "claude-haiku-4-5";
  const hasApiKey = !!settings.apiKeys[provider]?.trim();

  const modelLabel = (() => {
    try {
      return getModelLabel(provider as APIProvider, model);
    } catch {
      return model;
    }
  })();

  // Known providers get their canonical casing (e.g. "OpenAI", not "Openai");
  // anything else falls back to simple capitalization.
  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
    openrouter: "OpenRouter",
  };
  const providerLabel =
    PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[440px] rounded-xl border shadow-2xl"
          style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-light)" }}>
            <div className="flex items-center gap-2">
              <Rocket size={16} style={{ color: "var(--accent)" }} />
              <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Start Self-Drive?
              </Dialog.Title>
            </div>
            <Dialog.Close className="p-1 rounded hover:bg-bg-elevated transition-colors">
              <X size={14} style={{ color: "var(--text-ghost)" }} />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              CodeMantis will autonomously implement{" "}
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {remainingSessions} remaining session{remainingSessions > 1 ? "s" : ""}
              </span>{" "}
              from this guide:
            </p>

            <div
              className="px-3 py-2.5 rounded-lg border text-label space-y-1"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--border-light)", color: "var(--text-secondary)" }}
            >
              <p>For each session:</p>
              <ul className="list-disc ml-4 space-y-0.5">
                <li>Send the build prompt to Claude Code</li>
                {settings.selfDriveRunBuildCheck && <li>Run build checks (typecheck)</li>}
                <li>Verify the implementation against the spec</li>
                <li>Fix failures automatically (up to {settings.selfDriveMaxFixAttempts} attempts)</li>
                {settings.selfDriveRunTests && <li>Run tests</li>}
                <li>Advance to the next session</li>
              </ul>
            </div>

            <div
              className="px-3 py-2 rounded-lg text-label space-y-1"
              style={{
                background: "rgba(var(--accent-rgb, 99, 102, 241), 0.06)",
                color: "var(--text-secondary)",
              }}
            >
              <p>
                Your session switches to{" "}
                <span className="font-medium" style={{ color: "var(--color-green, #22c55e)" }}>
                  Auto-Accept
                </span>{" "}
                mode during the run and returns to{" "}
                <span className="font-medium">{currentMode}</span> when done.
              </p>
            </div>

            <div className="flex items-center gap-4 text-label" style={{ color: "var(--text-ghost)" }}>
              <span>Orchestrator: {providerLabel} / {modelLabel}</span>
              <span>Est. cost: ~$0.05 - $0.50</span>
            </div>

            <p className="text-detail leading-relaxed" style={{ color: "var(--text-ghost)" }}>
              Self-Drive pauses automatically on failures it can't fix. You can also pause manually at any time.
            </p>

            {!hasApiKey && (
              <div
                className="px-3 py-2 rounded-lg border text-label"
                style={{
                  background: "rgba(239, 68, 68, 0.06)",
                  borderColor: "rgba(239, 68, 68, 0.3)",
                  color: "var(--red, #ef4444)",
                }}
              >
                No API key configured for {providerLabel}. Add one in Settings &rarr; AI Providers.
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-5 py-3 border-t"
            style={{ borderColor: "var(--border-light)" }}
          >
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs transition-colors hover:bg-bg-elevated"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={!hasApiKey || !activeSessionId}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--accent)", color: "white" }}
            >
              <Rocket size={12} />
              Start Self-Drive
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
