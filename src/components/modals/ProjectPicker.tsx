import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../../stores/uiStore";

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

export function addRecentProject(path: string): void {
  const recent = getRecentProjects().filter((p) => p !== path);
  recent.unshift(path);
  localStorage.setItem(
    RECENT_PROJECTS_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT))
  );
}

interface ProjectPickerProps {
  onSelectProject: (path: string) => void;
}

export default function ProjectPicker({ onSelectProject }: ProjectPickerProps) {
  const showProjectPicker = useUiStore((s) => s.showProjectPicker);
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (showProjectPicker) {
      setRecentProjects(getRecentProjects());
      setProjectPath("");
      setError(null);
      setStarting(false);
    }
  }, [showProjectPicker]);

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

  const handleStart = async (path?: string) => {
    const resolvedPath = (path ?? projectPath).trim();
    if (!resolvedPath) return;
    setStarting(true);
    setError(null);
    try {
      addRecentProject(resolvedPath);
      setRecentProjects(getRecentProjects());
      onSelectProject(resolvedPath);
      setShowProjectPicker(false);
    } catch (e) {
      console.error("Failed to start session:", e);
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  const folderName = projectPath
    ? projectPath.split("/").filter(Boolean).pop()
    : "";

  return (
    <Dialog.Root open={showProjectPicker} onOpenChange={setShowProjectPicker}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[440px] rounded-xl border border-border p-6" style={{ background: "var(--bg-primary)" }}>
          <Dialog.Title className="text-lg text-text-primary font-medium mb-1">
            New Project
          </Dialog.Title>
          <Dialog.Description className="text-ui text-text-dim mb-4">
            Select a project folder to open a new workspace
          </Dialog.Description>

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
            onClick={() => handleStart()}
            disabled={!projectPath.trim() || starting}
            className={`w-full py-2.5 rounded-lg text-ui font-medium transition-all ${
              projectPath.trim() && !starting
                ? "bg-accent text-white hover:bg-accent-light"
                : "bg-bg-elevated text-text-ghost cursor-not-allowed"
            }`}
          >
            {starting ? "Starting..." : "Open Project"}
          </button>

          {error && (
            <p className="mt-2 text-red text-label">{error}</p>
          )}

          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <div className="mt-4">
              <p className="text-text-dim text-label uppercase tracking-wider mb-2">Recent Projects</p>
              <div className="space-y-1">
                {recentProjects.map((path) => {
                  const name = path.split("/").filter(Boolean).pop();
                  return (
                    <button
                      key={path}
                      onClick={() => handleStart(path)}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
