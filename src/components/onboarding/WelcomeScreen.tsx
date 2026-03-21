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
  AlertTriangle,
  Search,
  GitBranch,
} from "lucide-react";
import type { ClaudeStatus } from "../../lib/tauri-commands";

interface WelcomeScreenProps {
  claudeStatus: ClaudeStatus | null;
  rechecking: boolean;
  onRecheck: () => void;
  onGetStarted: (skipFuture: boolean) => void;
  onOpenProject: () => void;
  onNewProject: () => void;
  onCloneRepo: () => void;
  onOpenSettings: () => void;
  onSelectClaudeBinary: () => void;
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
        ? "Logged in at Claude Code"
        : "Not authenticated",
      satisfied: status?.authenticated ?? false,
      helpCommand: "claude login",
    },
    {
      label: "You are cool and motivated \u{1F680}",
      description: "Ready to build something awesome",
      satisfied: true,
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
  onCloneRepo,
  onOpenSettings,
  onSelectClaudeBinary,
}: WelcomeScreenProps) {
  const [skipFuture, setSkipFuture] = useState(true);
  const prerequisites = getPrerequisites(claudeStatus);
  const prerequisitesMet = prerequisites.every((p) => p.satisfied);
  const claudeNotFound = !(claudeStatus?.installed ?? false);

  return (
    <div
      className="h-screen w-screen flex flex-col"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Draggable title bar area */}
      <div className="h-12 shrink-0" data-tauri-drag-region />

      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div className="w-full max-w-3xl px-8 overflow-y-auto max-h-full flex flex-col">
          {/* Logo + Title */}
          <div className="text-center mb-8">
            <img
              src="/CodeMantisIcon.png"
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

          {/* Claude Code not found info box */}
          {claudeNotFound && (
            <div
              className="rounded-xl border px-5 py-4 mb-6 flex items-start gap-4"
              style={{
                borderColor: "var(--yellow, #b8860b)",
                background: "color-mix(in srgb, var(--yellow, #b8860b) 8%, var(--bg-subtle))",
              }}
            >
              <AlertTriangle
                size={20}
                className="shrink-0 mt-0.5"
                style={{ color: "var(--yellow, #b8860b)" }}
              />
              <div className="flex-1 min-w-0" style={{ fontSize: "13px" }}>
                <p className="text-text-primary font-medium mb-1.5">
                  Claude Code not found
                </p>
                <p className="text-text-secondary leading-relaxed mb-3">
                  CodeMantis is a coding application built around Claude Code. It needs
                  Claude Code installed to work. Please check your Claude Code installation.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href="https://claude.com/product/claude-code"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium transition-colors"
                    style={{
                      color: "var(--accent)",
                      fontSize: "13px",
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      import("@tauri-apps/plugin-opener").then((mod) =>
                        mod.openUrl("https://claude.com/product/claude-code")
                      );
                    }}
                  >
                    Get Claude Code
                    <ArrowRight size={13} />
                  </a>
                  <span className="text-text-ghost">or</span>
                  <button
                    onClick={onSelectClaudeBinary}
                    className="inline-flex items-center gap-1.5 font-medium transition-colors hover:opacity-80"
                    style={{ color: "var(--accent)", fontSize: "13px" }}
                  >
                    <Search size={13} />
                    Locate Claude Code
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div
            className="text-text-secondary mb-8 leading-relaxed text-left"
            style={{ fontSize: "13px" }}
          >
            <p className="font-semibold text-text-primary mb-2" style={{ fontSize: "15px" }}>
              CodeMantis: The AI Coding Studio for the Rest of Us.
            </p>
            <p className="mb-3">
              You have the vision; now you have the environment to build it.{" "}
              <strong className="text-text-primary">CodeMantis</strong> brings the power of
              Claude Code into a beautiful, native macOS interface designed for the
              &quot;vibe coding&quot; era.
            </p>
            <p className="mb-2">Skip the terminal hurdles and stay in your flow with:</p>
            <ul className="list-disc pl-5 space-y-1.5 mb-3">
              <li>
                <strong className="text-text-primary">Visual Session Management</strong>{" "}
                – Organize your thoughts and threads effortlessly.
              </li>
              <li>
                <strong className="text-text-primary">Your Ideas to AI-powered Specifications to Claude Code</strong>{" "}
                – Integrated to work.
              </li>
              <li>
                <strong className="text-text-primary">Real-time Activity Tracking</strong>{" "}
                – See exactly what your AI is doing as it happens.
              </li>
            </ul>
            <p className="font-semibold text-text-primary">100% Open Source.</p>
          </div>

          {/* Requirements + First steps side by side */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Requirements card */}
            <div
              className="rounded-xl border flex flex-col"
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
                  className="flex items-start gap-3 px-4 py-3"
                  style={
                    i < prerequisites.length - 1
                      ? { borderBottom: "1px solid var(--border)" }
                      : undefined
                  }
                >
                  <div className="shrink-0 mt-0.5">
                    {prereq.satisfied ? (
                      <CheckCircle2 size={16} style={{ color: "var(--green)" }} />
                    ) : (
                      <Circle size={16} className="text-text-ghost" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-text-primary font-medium block"
                      style={{ fontSize: "13px" }}
                    >
                      {prereq.label}
                    </span>
                    <span className="text-text-dim block" style={{ fontSize: "12px" }}>
                      {prereq.description}
                    </span>
                    {!prereq.satisfied && prereq.helpCommand && (
                      <code
                        className="text-accent font-mono px-1.5 py-0.5 rounded inline-block mt-1"
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
                </div>
              ))}
            </div>

            {/* First steps card */}
            <div
              className="rounded-xl border flex flex-col"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-subtle)",
              }}
            >
              <div
                className="px-4 py-3"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <span
                  className="text-text-secondary font-medium"
                  style={{ fontSize: "13px" }}
                >
                  First steps...
                </span>
              </div>

              <div className="flex-1 flex flex-col">
                {/* Add AI API Keys */}
                <button
                  onClick={onOpenSettings}
                  disabled={!prerequisitesMet}
                  className="flex items-center gap-3 px-4 py-3 transition-all text-left group"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: prerequisitesMet ? 1 : 0.5,
                    cursor: prerequisitesMet ? "pointer" : "not-allowed",
                  }}
                  title="Configure API keys for AI assistants"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-dim)" }}
                  >
                    <Key size={14} className="text-accent" />
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
                    <p className="text-text-dim" style={{ fontSize: "11px" }}>
                      Multi-AI assistant &amp; changelog
                    </p>
                  </div>
                </button>

                {/* Open a Project */}
                <button
                  onClick={onOpenProject}
                  disabled={!prerequisitesMet}
                  className="flex items-center gap-3 px-4 py-3 transition-all text-left group"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: prerequisitesMet ? 1 : 0.5,
                    cursor: prerequisitesMet ? "pointer" : "not-allowed",
                  }}
                  title="Open an existing project folder"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-dim)" }}
                  >
                    <FolderOpen size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-text-primary font-medium block"
                      style={{ fontSize: "13px" }}
                    >
                      Open a Project
                    </span>
                    <p className="text-text-dim" style={{ fontSize: "11px" }}>
                      Open an existing folder
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-text-ghost shrink-0 group-hover:text-text-dim transition-colors"
                  />
                </button>

                {/* Clone from GitHub */}
                <button
                  onClick={onCloneRepo}
                  disabled={!prerequisitesMet}
                  className="flex items-center gap-3 px-4 py-3 transition-all text-left group"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: prerequisitesMet ? 1 : 0.5,
                    cursor: prerequisitesMet ? "pointer" : "not-allowed",
                  }}
                  title="Clone a Git repository"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-dim)" }}
                  >
                    <GitBranch size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-text-primary font-medium block"
                      style={{ fontSize: "13px" }}
                    >
                      Clone from GitHub
                    </span>
                    <p className="text-text-dim" style={{ fontSize: "11px" }}>
                      Clone a Git repository
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-text-ghost shrink-0 group-hover:text-text-dim transition-colors"
                  />
                </button>

                {/* Create New Project */}
                <button
                  onClick={onNewProject}
                  disabled={!prerequisitesMet}
                  className="flex items-center gap-3 px-4 py-3 transition-all text-left group"
                  style={{
                    opacity: prerequisitesMet ? 1 : 0.5,
                    cursor: prerequisitesMet ? "pointer" : "not-allowed",
                  }}
                  title="Create a new project from template"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-dim)" }}
                  >
                    <Plus size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-text-primary font-medium block"
                      style={{ fontSize: "13px" }}
                    >
                      Create New Project
                    </span>
                    <p className="text-text-dim" style={{ fontSize: "11px" }}>
                      Scaffold from a template
                    </p>
                  </div>
                  <ArrowRight
                    size={14}
                    className="text-text-ghost shrink-0 group-hover:text-text-dim transition-colors"
                  />
                </button>
              </div>
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
