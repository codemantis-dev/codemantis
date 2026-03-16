import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  RefreshCw,
  ArrowRight,
  FolderOpen,
  Plus,
  Key,
  Sparkles,
} from "lucide-react";
import type { ClaudeStatus } from "../../lib/tauri-commands";

interface WelcomeScreenProps {
  claudeStatus: ClaudeStatus | null;
  rechecking: boolean;
  onRecheck: () => void;
  onGetStarted: (skipFuture: boolean) => void;
  onOpenProject: () => void;
  onNewProject: () => void;
  onOpenSettings: () => void;
}

interface Prerequisite {
  label: string;
  description: string;
  satisfied: boolean;
  helpCommand?: string;
}

function getPrerequisites(status: ClaudeStatus | null): Prerequisite[] {
  return [
    {
      label: "Claude Code CLI",
      description: status?.installed
        ? `Installed${status.version ? ` (v${status.version})` : ""}`
        : "Not installed",
      satisfied: status?.installed ?? false,
      helpCommand: "npm install -g @anthropic-ai/claude-code",
    },
    {
      label: "Authentication",
      description: status?.authenticated
        ? "Logged in and ready"
        : "Not authenticated",
      satisfied: status?.authenticated ?? false,
      helpCommand: "claude login",
    },
  ];
}

export default function WelcomeScreen({
  claudeStatus,
  rechecking,
  onRecheck,
  onGetStarted,
  onOpenProject,
  onNewProject,
  onOpenSettings,
}: WelcomeScreenProps) {
  const [skipFuture, setSkipFuture] = useState(true);
  const prerequisites = getPrerequisites(claudeStatus);
  const prerequisitesMet = prerequisites.every((p) => p.satisfied);

  return (
    <div
      className="h-screen w-screen flex flex-col"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Draggable title bar area */}
      <div className="h-12 shrink-0" data-tauri-drag-region />

      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="w-full max-w-lg px-8 overflow-y-auto max-h-full flex flex-col">
          {/* Logo + Title */}
          <div className="text-center mb-8">
            <img
              src="/codemantis_app_icon.png"
              alt="CodeMantis"
              className="w-[146px] h-[146px] rounded-3xl mb-5 inline-block"
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

          {/* Description */}
          <p
            className="text-text-secondary text-center mb-8 leading-relaxed"
            style={{ fontSize: "13px" }}
          >
            CodeMantis is a native macOS application that wraps the Claude Code CLI
            with a modern, feature-rich desktop interface. Manage multiple sessions,
            browse and edit files, track real-time activity, generate changelogs,
            and chat with AI assistants — all from one app designed to make your
            daily coding workflow faster and more enjoyable.
          </p>

          {/* Requirements card */}
          <div
            className="rounded-xl border mb-6"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-subtle)",
            }}
          >
            {/* Card header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span
                className="text-text-secondary font-medium flex items-center gap-2"
                style={{ fontSize: "13px" }}
              >
                <Sparkles size={14} className="text-text-dim" />
                Requirements
              </span>
              <button
                onClick={onRecheck}
                disabled={rechecking}
                className="flex items-center gap-1.5 text-accent hover:text-accent-light transition-colors disabled:opacity-50"
                style={{ fontSize: "12px" }}
                title="Re-check requirements"
              >
                <RefreshCw
                  size={12}
                  className={rechecking ? "animate-spin" : ""}
                />
                {rechecking ? "Checking..." : "Re-check"}
              </button>
            </div>

            {/* Prerequisite rows */}
            {prerequisites.map((prereq, i) => (
              <div
                key={prereq.label}
                className="flex items-center gap-3 px-4 py-3"
                style={
                  i < prerequisites.length - 1
                    ? { borderBottom: "1px solid var(--border)" }
                    : undefined
                }
              >
                <div className="shrink-0">
                  {prereq.satisfied ? (
                    <CheckCircle2 size={18} style={{ color: "var(--green)" }} />
                  ) : (
                    <Circle size={18} className="text-text-ghost" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-text-primary font-medium"
                      style={{ fontSize: "13px" }}
                    >
                      {prereq.label}
                    </span>
                    <span className="text-text-dim" style={{ fontSize: "12px" }}>
                      {prereq.description}
                    </span>
                  </div>
                </div>
                {!prereq.satisfied && prereq.helpCommand && (
                  <code
                    className="text-accent font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      fontSize: "11px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {prereq.helpCommand}
                  </code>
                )}
              </div>
            ))}
          </div>

          {/* What now... section */}
          <div className="mb-6">
            <h2
              className="text-text-secondary font-medium mb-3"
              style={{ fontSize: "13px" }}
            >
              What now...
            </h2>
            <div className="space-y-2">
              {/* Add AI API Keys */}
              <button
                onClick={onOpenSettings}
                disabled={!prerequisitesMet}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left group"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-subtle)",
                  opacity: prerequisitesMet ? 1 : 0.5,
                  cursor: prerequisitesMet ? "pointer" : "not-allowed",
                }}
                title="Configure API keys for AI assistants"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--accent-dim)" }}
                >
                  <Key size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-text-primary font-medium"
                      style={{ fontSize: "13px" }}
                    >
                      Add AI API Keys
                    </span>
                    <span
                      className="text-text-ghost px-1.5 py-0.5 rounded"
                      style={{
                        fontSize: "10px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Optional
                    </span>
                  </div>
                  <p className="text-text-dim" style={{ fontSize: "12px" }}>
                    Configure keys for multi-AI assistant &amp; changelog features
                  </p>
                </div>
              </button>

              {/* Open a Project */}
              <button
                onClick={onOpenProject}
                disabled={!prerequisitesMet}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left group"
                style={{
                  borderColor: prerequisitesMet
                    ? "var(--border)"
                    : "var(--border)",
                  background: "var(--bg-subtle)",
                  opacity: prerequisitesMet ? 1 : 0.5,
                  cursor: prerequisitesMet ? "pointer" : "not-allowed",
                }}
                title="Open an existing project folder"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--accent-dim)" }}
                >
                  <FolderOpen size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <span
                    className="text-text-primary font-medium block"
                    style={{ fontSize: "13px" }}
                  >
                    Open a Project
                  </span>
                  <p className="text-text-dim" style={{ fontSize: "12px" }}>
                    Open an existing folder to start a session
                  </p>
                </div>
                <ArrowRight
                  size={16}
                  className="text-text-ghost shrink-0 group-hover:text-text-dim transition-colors"
                />
              </button>

              {/* Create New Project */}
              <button
                onClick={onNewProject}
                disabled={!prerequisitesMet}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left group"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-subtle)",
                  opacity: prerequisitesMet ? 1 : 0.5,
                  cursor: prerequisitesMet ? "pointer" : "not-allowed",
                }}
                title="Create a new project from template"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "var(--accent-dim)" }}
                >
                  <Plus size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <span
                    className="text-text-primary font-medium block"
                    style={{ fontSize: "13px" }}
                  >
                    Create New Project
                  </span>
                  <p className="text-text-dim" style={{ fontSize: "12px" }}>
                    Scaffold a new project from a template
                  </p>
                </div>
                <ArrowRight
                  size={16}
                  className="text-text-ghost shrink-0 group-hover:text-text-dim transition-colors"
                />
              </button>
            </div>
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between mb-4">
            <label
              className="flex items-center gap-2 cursor-pointer select-none"
              style={{ fontSize: "12px" }}
            >
              <input
                type="checkbox"
                checked={skipFuture}
                onChange={(e) => setSkipFuture(e.target.checked)}
                className="accent-accent rounded"
              />
              <span className="text-text-dim">Do not show this again</span>
            </label>

            {prerequisitesMet && (
              <button
                onClick={() => onGetStarted(skipFuture)}
                className="text-text-dim hover:text-text-secondary transition-colors"
                style={{ fontSize: "12px" }}
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
