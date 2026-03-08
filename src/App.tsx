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
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export default function App() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasSessions = useSessionStore((s) => s.tabOrder.length > 0);
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const { startSession } = useClaudeSession();
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useKeyboardShortcuts();

  useEffect(() => {
    checkClaudeStatus()
      .then(setClaudeStatus)
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
      setError(String(e));
    }
  };

  if (checking) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <p className="text-text-dim">Checking Claude Code installation...</p>
      </div>
    );
  }

  if (claudeStatus && !claudeStatus.installed) {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center max-w-md p-8">
          <h2 className="text-xl text-text-primary font-medium mb-3">
            Claude Code Not Found
          </h2>
          <p className="text-text-secondary mb-4">
            ClaudeForge requires the Claude Code CLI. Install it with:
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
    );
  }

  if (!hasSessions) {
    // Show welcome screen — first launch / no sessions
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="w-full max-w-md p-8">
          <div className="text-center mb-8">
            <h2 className="text-xl text-text-primary font-medium mb-1">
              ClaudeForge
            </h2>
            <p className="text-text-dim text-ui">
              {claudeStatus?.version && (
                <span>Claude Code {claudeStatus.version}</span>
              )}
            </p>
          </div>

          <button
            onClick={() => setShowProjectPicker(true)}
            className="w-full mb-3 px-4 py-3 rounded-lg border border-dashed border-border hover:border-accent/40 bg-bg-subtle hover:bg-bg-elevated transition-colors text-center"
          >
            <span className="text-text-secondary text-ui">
              Open a project to get started...
            </span>
          </button>

          {error && (
            <p className="mt-2 text-red text-label">{error}</p>
          )}
        </div>

        <ProjectPicker onSelectProject={handleSelectProject} />
        <SettingsModal />
      </div>
    );
  }

  return (
    <>
      <AppShell />
      <ToolApproval />
      <ProjectPicker onSelectProject={handleSelectProject} />
      <SettingsModal />
    </>
  );
}
