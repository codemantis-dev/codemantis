import { useEffect, useState } from "react";
import { Plus, FolderOpen } from "lucide-react";
import { checkClaudeStatus, cleanupOldAttachments, type ClaudeStatus } from "./lib/tauri-commands";
import { useClaudeSession } from "./hooks/useClaudeSession";
import { useSessionStore } from "./stores/sessionStore";
import { useUiStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import AppShell from "./components/layout/AppShell";
import ToolApproval from "./components/modals/ToolApproval";
import ProjectPicker, { addRecentProject, getRecentProjects } from "./components/modals/ProjectPicker";
import SettingsModal from "./components/modals/SettingsModal";
import McpModal from "./components/modals/McpModal";
import QuestionModal from "./components/modals/QuestionModal";
import CliOverlay from "./components/modals/CliOverlay";
import Toast from "./components/shared/Toast";
import { showToast } from "./stores/toastStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useToolApprovalListener } from "./hooks/useToolApprovalListener";

export default function App() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasSessions = useSessionStore((s) => s.tabOrder.length > 0);
  const openProjectPicker = useUiStore((s) => s.openProjectPicker);
  const { startSession } = useClaudeSession();
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useKeyboardShortcuts();
  useToolApprovalListener();

  useEffect(() => {
    checkClaudeStatus()
      .then((status) => {
        setClaudeStatus(status);
        if (status.binary_path) {
          useUiStore.getState().setClaudeBinaryPath(status.binary_path);
        }
      })
      .catch((e) => console.error("Status check failed:", e))
      .finally(() => setChecking(false));
    loadSettings();
  }, [loadSettings]);

  const handleSelectProject = async (path: string) => {
    setError(null);
    try {
      await startSession(path);
      addRecentProject(path);
      // Cleanup old attachments (7 days) for this project
      cleanupOldAttachments(path, 7).catch(() => {});
    } catch (e) {
      console.error("Failed to start session:", e);
      const msg = String(e);
      setError(msg);
      showToast(`Failed to start session: ${msg}`, "error");
    }
  };

  if (checking) {
    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-dim">Checking Claude Code installation...</p>
        </div>
      </div>
    );
  }

  if (claudeStatus && !claudeStatus.installed) {
    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <h2 className="text-xl text-text-primary font-medium mb-3">
              Claude Code Not Found
            </h2>
            <p className="text-text-secondary mb-4">
              CodeMantis requires the Claude Code CLI. Install it with:
            </p>
            <code className="block px-4 py-2 rounded-lg bg-bg-elevated text-accent-light font-mono text-ui mb-4">
              npm install -g @anthropic-ai/claude-code
            </code>
            <p className="text-text-faint text-ui">
              Then run <code className="text-accent-light">claude login</code> to
              authenticate.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasSessions) {
    const recentProjects = getRecentProjects();

    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-lg p-8">
            {/* Logo and title */}
            <div className="text-center mb-8">
              <img
                src="/codemantis_app_icon.png"
                alt="CodeMantis"
                className="w-16 h-16 rounded-2xl mb-4 inline-block"
              />
              <h2 className="text-2xl text-text-primary font-semibold mb-1">
                CodeMantis
              </h2>
              <p className="text-text-secondary text-ui">
                {claudeStatus?.version ? (
                  <span>Claude Code {claudeStatus.version}</span>
                ) : (
                  <span>Native UI for Claude Code</span>
                )}
              </p>
              <p className="text-text-ghost text-label mt-1">v{__APP_VERSION__}</p>
            </div>

            {/* Two action cards */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <button
                onClick={() => openProjectPicker("templates")}
                className="px-4 py-5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
              >
                <Plus size={22} className="mx-auto mb-2 text-text-ghost group-hover:text-accent transition-colors" />
                <span className="text-text-primary text-ui font-medium block mb-0.5">
                  New Project
                </span>
                <span className="text-text-dim text-label">
                  Start from a template
                </span>
              </button>

              <button
                onClick={() => openProjectPicker("open")}
                className="px-4 py-5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
              >
                <FolderOpen size={22} className="mx-auto mb-2 text-text-ghost group-hover:text-accent transition-colors" />
                <span className="text-text-primary text-ui font-medium block mb-0.5">
                  Open Project
                </span>
                <span className="text-text-dim text-label">
                  Open an existing folder
                </span>
              </button>
            </div>

            {/* Inline recent projects */}
            {recentProjects.length > 0 && (
              <div>
                <p className="text-text-ghost text-label uppercase tracking-wider mb-2">Recent Projects</p>
                <div className="space-y-1">
                  {recentProjects.map((path) => {
                    const name = path.split("/").filter(Boolean).pop();
                    return (
                      <button
                        key={path}
                        onClick={() => handleSelectProject(path)}
                        className="w-full px-3 py-2 rounded-lg text-left hover:bg-bg-elevated transition-colors group flex items-center gap-3"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost group-hover:text-text-dim shrink-0">
                          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <div className="min-w-0">
                          <span className="text-text-secondary group-hover:text-text-primary text-ui block truncate">{name}</span>
                          <span className="text-text-ghost group-hover:text-text-dim text-label block truncate">{path}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Keyboard hint */}
            <p className="text-center text-text-ghost text-label mt-6">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-light text-text-faint">Cmd+Shift+N</kbd> new project
              <span className="mx-2 text-text-ghost/40">|</span>
              <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-light text-text-faint">Cmd+O</kbd> open folder
            </p>

            {error && (
              <p className="mt-2 text-red text-label text-center">{error}</p>
            )}
          </div>
        </div>

        <ProjectPicker onSelectProject={handleSelectProject} />
        <SettingsModal />
        <McpModal />
        <Toast />
      </div>
    );
  }

  return (
    <>
      <AppShell />
      <ToolApproval />
      <QuestionModal />
      <CliOverlay />
      <ProjectPicker onSelectProject={handleSelectProject} />
      <SettingsModal />
      <McpModal />
      <Toast />
    </>
  );
}
