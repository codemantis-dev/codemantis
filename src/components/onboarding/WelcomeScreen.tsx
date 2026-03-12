import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  RefreshCw,
  Terminal,
  ArrowRight,
  FolderOpen,
  Plus,
} from "lucide-react";
import type { ClaudeStatus } from "../../lib/tauri-commands";

interface WelcomeScreenProps {
  claudeStatus: ClaudeStatus | null;
  rechecking: boolean;
  onRecheck: () => void;
  onGetStarted: (skipFuture: boolean) => void;
  onOpenProject: () => void;
  onNewProject: () => void;
}

interface StepItem {
  label: string;
  description: string;
  satisfied: boolean;
  helpText?: string;
}

function getSteps(status: ClaudeStatus | null, hasProject: boolean): StepItem[] {
  return [
    {
      label: "Claude Code CLI",
      description: status?.installed
        ? `Installed (${status.version ? `v${status.version}` : "found"})`
        : "Not installed",
      satisfied: status?.installed ?? false,
      helpText: "npm install -g @anthropic-ai/claude-code",
    },
    {
      label: "Authentication",
      description: status?.authenticated
        ? "Logged in and ready"
        : "Not authenticated",
      satisfied: status?.authenticated ?? false,
      helpText: "claude login",
    },
    {
      label: "Open a Project",
      description: hasProject
        ? "Project selected"
        : "Open an existing folder or create from template",
      satisfied: hasProject,
    },
  ];
}

function StepCard({
  step,
  index,
  actions,
}: {
  step: StepItem;
  index: number;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5 transition-all"
      style={{
        borderColor: step.satisfied
          ? "var(--border)"
          : "var(--border-light)",
        background: "var(--bg-primary)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {step.satisfied ? (
            <CheckCircle2 size={20} className="text-green" />
          ) : (
            <Circle size={20} className="text-text-ghost" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-medium" style={{ fontSize: "14px" }}>
              {step.label}
            </span>
            {!step.satisfied && step.helpText && (
              <code
                className="text-accent font-mono px-1.5 py-0.5 rounded"
                style={{
                  fontSize: "11px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                {step.helpText}
              </code>
            )}
          </div>
          <p className="text-text-dim mt-0.5" style={{ fontSize: "12px" }}>
            {step.description}
          </p>
          {actions && !step.satisfied && (
            <div className="mt-2.5 flex gap-2">{actions}</div>
          )}
        </div>
        <span className="text-text-ghost shrink-0 mt-0.5" style={{ fontSize: "11px" }}>
          {index + 1}
        </span>
      </div>
    </div>
  );
}

export default function WelcomeScreen({
  claudeStatus,
  rechecking,
  onRecheck,
  onGetStarted,
  onOpenProject,
  onNewProject,
}: WelcomeScreenProps) {
  const [skipFuture, setSkipFuture] = useState(true);
  const hasProject = false; // Always false on welcome screen — user hasn't opened anything yet
  const steps = getSteps(claudeStatus, hasProject);
  const prerequisitesMet = steps[0].satisfied && steps[1].satisfied;

  return (
    <div
      className="h-screen w-screen flex flex-col"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Draggable title bar area */}
      <div className="h-12 shrink-0" data-tauri-drag-region />

      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="w-full max-w-md px-8 flex flex-col max-h-full">
          {/* Logo + Title */}
          <div className="text-center mb-10">
            <img
              src="/codemantis_app_icon.png"
              alt="CodeMantis"
              className="w-28 h-28 rounded-2xl mb-5 inline-block"
              style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}
            />
            <h1
              className="text-text-primary font-semibold mb-1.5"
              style={{ fontSize: "26px" }}
            >
              Welcome to CodeMantis
            </h1>
            <p className="text-text-secondary" style={{ fontSize: "14px" }}>
              Native desktop UI for Claude Code
            </p>
            <p className="text-text-ghost mt-1" style={{ fontSize: "12px" }}>
              v{__APP_VERSION__}
            </p>
          </div>

          {/* Prerequisites */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2
                className="text-text-secondary font-medium flex items-center gap-2"
                style={{ fontSize: "13px" }}
              >
                <Terminal size={14} className="text-text-dim" />
                Prerequisites
              </h2>
              <button
                onClick={onRecheck}
                disabled={rechecking}
                className="flex items-center gap-1.5 text-accent hover:text-accent-light transition-colors disabled:opacity-50"
                style={{ fontSize: "12px" }}
                aria-label="Re-check prerequisites"
              >
                <RefreshCw
                  size={12}
                  className={rechecking ? "animate-spin" : ""}
                />
                {rechecking ? "Checking..." : "Re-check"}
              </button>
            </div>

            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepCard
                  key={step.label}
                  step={step}
                  index={i}
                  actions={
                    i === 2 && prerequisitesMet ? (
                      <>
                        <button
                          onClick={onOpenProject}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent hover:text-accent-light transition-colors"
                          style={{
                            fontSize: "12px",
                            border: "1px solid var(--border)",
                            background: "var(--bg-subtle)",
                          }}
                        >
                          <FolderOpen size={13} />
                          Open Folder
                        </button>
                        <button
                          onClick={onNewProject}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-accent hover:text-accent-light transition-colors"
                          style={{
                            fontSize: "12px",
                            border: "1px solid var(--border)",
                            background: "var(--bg-subtle)",
                          }}
                        >
                          <Plus size={13} />
                          New from Template
                        </button>
                      </>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </div>

          {/* Do not show again checkbox */}
          <label
            className="flex items-center gap-2 mb-4 cursor-pointer select-none"
            style={{ fontSize: "12px" }}
          >
            <input
              type="checkbox"
              checked={skipFuture}
              onChange={(e) => setSkipFuture(e.target.checked)}
              className="accent-accent rounded"
            />
            <span className="text-text-dim">
              Do not show this again
            </span>
          </label>

          {/* Get Started button */}
          <button
            onClick={() => onGetStarted(skipFuture)}
            disabled={!prerequisitesMet}
            className="w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
            style={{
              fontSize: "14px",
              background: prerequisitesMet
                ? "var(--accent)"
                : "var(--bg-elevated)",
              color: prerequisitesMet ? "white" : "var(--text-ghost)",
              cursor: prerequisitesMet ? "pointer" : "not-allowed",
              boxShadow: prerequisitesMet
                ? "0 4px 16px rgba(var(--accent-rgb, 0,0,0), 0.2)"
                : "none",
            }}
          >
            Get Started
            {prerequisitesMet && <ArrowRight size={16} />}
          </button>

          {!prerequisitesMet && (
            <p
              className="text-center text-text-ghost mt-3"
              style={{ fontSize: "11px" }}
            >
              Install and authenticate Claude Code to continue
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
