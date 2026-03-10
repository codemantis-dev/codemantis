import { useEffect, useState } from "react";
import { checkClaudeStatus, cleanupOldAttachments, type ClaudeStatus } from "./lib/tauri-commands";
import { useClaudeSession } from "./hooks/useClaudeSession";
import { useSessionStore } from "./stores/sessionStore";
import { useUiStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import AppShell from "./components/layout/AppShell";
import ToolApproval from "./components/modals/ToolApproval";
import ProjectPicker, { addRecentProject } from "./components/modals/ProjectPicker";
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
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
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
    // Show welcome screen — first launch / no sessions
    return (
      <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
        <div className="h-12 shrink-0" data-tauri-drag-region />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md p-8">
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

            <button
              onClick={() => setShowProjectPicker(true)}
              className="w-full mb-3 px-4 py-3.5 rounded-xl border border-dashed border-border hover:border-accent/50 bg-bg-subtle hover:bg-bg-elevated transition-all text-center group"
            >
              <span className="text-text-secondary group-hover:text-text-primary text-ui transition-colors">
                Open a project to get started...
              </span>
            </button>

            <p className="text-center text-text-ghost text-label mt-4">
              Press <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-light text-text-faint">Cmd+Shift+N</kbd> to open a new project
            </p>

            {error && (
              <p className="mt-2 text-red text-label">{error}</p>
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
