import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { checkClaudeStatus, type ClaudeStatus } from "./lib/tauri-commands";
import { useClaudeSession } from "./hooks/useClaudeSession";
import { useSessionStore } from "./stores/sessionStore";
import AppShell from "./components/layout/AppShell";
import ToolApproval from "./components/modals/ToolApproval";

const RECENT_PROJECTS_KEY = "claudeforge-recent-projects";
const MAX_RECENT = 5;

function getRecentProjects(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentProject(path: string): void {
  const recent = getRecentProjects().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(
    RECENT_PROJECTS_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT))
  );
}

export default function App() {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSessionStore((s) => s.session);
  const { startSession } = useClaudeSession();

  useEffect(() => {
    checkClaudeStatus()
      .then(setClaudeStatus)
      .catch((e) => console.error("Status check failed:", e))
      .finally(() => setChecking(false));
    setRecentProjects(getRecentProjects());
  }, []);

  const handlePickFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Folder",
    });
    if (selected) {
      setProjectPath(selected as string);
      setError(null);
    }
  };

  const handleStartSession = async (path?: string) => {
    const resolvedPath = (path ?? projectPath).trim();
    if (!resolvedPath) return;
    setStarting(true);
    setError(null);
    try {
      await startSession(resolvedPath);
      addRecentProject(resolvedPath);
      setRecentProjects(getRecentProjects());
    } catch (e) {
      console.error("Failed to start session:", e);
      setError(String(e));
    } finally {
      setStarting(false);
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

  if (!session) {
    const folderName = projectPath ? projectPath.split("/").filter(Boolean).pop() : "";

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

          {/* Folder picker */}
          <button
            onClick={handlePickFolder}
            className="w-full mb-3 px-4 py-3 rounded-lg border border-dashed border-border hover:border-accent/40 bg-bg-subtle hover:bg-bg-elevated transition-colors text-left flex items-center gap-3"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-dim shrink-0">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {projectPath ? (
              <div className="min-w-0">
                <span className="text-text-primary text-ui font-medium block truncate">{folderName}</span>
                <span className="text-text-dim text-label block truncate">{projectPath}</span>
              </div>
            ) : (
              <span className="text-text-secondary text-ui">Select a project folder...</span>
            )}
          </button>

          {/* Start button */}
          <button
            onClick={() => handleStartSession()}
            disabled={!projectPath.trim() || starting}
            className={`w-full py-2.5 rounded-lg text-ui font-medium transition-all ${
              projectPath.trim() && !starting
                ? "bg-accent text-white hover:bg-accent-light"
                : "bg-bg-elevated text-text-ghost cursor-not-allowed"
            }`}
          >
            {starting ? "Starting..." : "Start Session"}
          </button>

          {error && (
            <p className="mt-2 text-red text-label">{error}</p>
          )}

          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <div className="mt-6">
              <p className="text-text-dim text-label uppercase tracking-wider mb-2">Recent Projects</p>
              <div className="space-y-1">
                {recentProjects.map((path) => {
                  const name = path.split("/").filter(Boolean).pop();
                  return (
                    <button
                      key={path}
                      onClick={() => handleStartSession(path)}
                      disabled={starting}
                      className="w-full px-3 py-2 rounded-lg text-left hover:bg-bg-elevated transition-colors group flex items-center gap-3"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost group-hover:text-text-dim shrink-0">
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
        </div>
      </div>
    );
  }

  return (
    <>
      <AppShell />
      <ToolApproval />
    </>
  );
}
