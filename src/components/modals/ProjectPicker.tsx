import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LayoutGrid, FolderOpen, Clock, GitBranch, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore, type ProjectPickerTab } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { translateError } from "../../lib/error-messages";
import ErrorCard from "../shared/ErrorCard";
import TemplatePicker from "./TemplatePicker";
import CloneForm from "./CloneForm";
import { getRecentProjects, addRecentProject, removeRecentProject } from "../../lib/recent-projects";

const TAB_ITEMS: { id: ProjectPickerTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "open", label: "Open Folder", icon: FolderOpen },
  { id: "clone", label: "Clone", icon: GitBranch },
  { id: "recent", label: "Recent", icon: Clock },
];

interface ProjectPickerProps {
  onSelectProject: (path: string) => void;
}

export default function ProjectPicker({ onSelectProject }: ProjectPickerProps) {
  const showProjectPicker = useUiStore((s) => s.showProjectPicker);
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const activeTab = useUiStore((s) => s.projectPickerTab);
  const setActiveTab = useUiStore((s) => s.setProjectPickerTab);

  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const detail = e instanceof Error ? e.message : String(e);
      setError(`Failed to open project: ${detail}`);
    } finally {
      setStarting(false);
    }
  };

  const handleTemplateProjectCreated = (projectPath: string) => {
    addRecentProject(projectPath);
    onSelectProject(projectPath);
    setShowProjectPicker(false);
  };

  const handleCloneComplete = (projectPath: string) => {
    addRecentProject(projectPath);
    onSelectProject(projectPath);
    setShowProjectPicker(false);
  };

  const handleClose = (): void => {
    if (busy) {
      showToast("Cannot close while an operation is in progress", "info");
      return;
    }
    setShowProjectPicker(false);
  };

  const handleRemoveRecent = (e: React.MouseEvent, path: string): void => {
    e.stopPropagation();
    removeRecentProject(path);
    setRecentProjects(getRecentProjects());
  };

  const folderName = projectPath
    ? projectPath.split("/").filter(Boolean).pop()
    : "";

  return (
    <Dialog.Root open={showProjectPicker} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border flex flex-col"
          style={{
            background: "var(--bg-primary)",
            width: "min(90vw, 680px)",
            height: "min(85vh, 600px)",
          }}
          onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        >
          {/* Header with tabs */}
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <Dialog.Title className="text-lg text-text-primary font-medium">
              {activeTab === "templates" ? "New Project" : activeTab === "open" ? "Open Project" : activeTab === "clone" ? "Clone from Git" : "Recent Projects"}
            </Dialog.Title>
            {!busy && (
              <Dialog.Close asChild>
                <button className="p-1 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors">
                  <X size={16} />
                </button>
              </Dialog.Close>
            )}
          </div>

          <Dialog.Description className="sr-only">
            Create a new project from a template, open an existing folder, or clone from Git
          </Dialog.Description>

          {/* Tab bar */}
          <div className="flex gap-1 px-5 pt-3 pb-0">
            {TAB_ITEMS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const recentCount = tab.id === "recent" ? recentProjects.length : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-label transition-colors ${
                    isActive
                      ? "bg-accent/15 text-accent"
                      : "text-text-dim hover:text-text-secondary hover:bg-bg-elevated"
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                  {tab.id === "recent" && recentCount > 0 && (
                    <span className="text-detail text-text-ghost ml-0.5">({recentCount})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-b border-border mx-5 mt-2" />

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            {activeTab === "templates" && (
              <div className="h-full">
                <TemplatePicker onProjectCreated={handleTemplateProjectCreated} onBusyChange={setBusy} />
              </div>
            )}

            {activeTab === "open" && (
              <div>
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
                  <ErrorCard
                    {...translateError(error)}
                    rawError={error}
                    compact
                    onDismiss={() => setError(null)}
                  />
                )}
              </div>
            )}

            {activeTab === "clone" && (
              <div>
                <CloneForm
                  onBack={() => setActiveTab("templates")}
                  onCloned={handleCloneComplete}
                  onBusyChange={setBusy}
                />
              </div>
            )}

            {activeTab === "recent" && (
              <div>
                {recentProjects.length === 0 ? (
                  <div className="flex items-center justify-center h-32">
                    <p className="text-text-dim text-label">No recent projects</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentProjects.map((path) => {
                      const name = path.split("/").filter(Boolean).pop();
                      return (
                        <button
                          key={path}
                          onClick={() => handleStart(path)}
                          disabled={starting}
                          className="w-full px-3 py-2.5 rounded-lg text-left hover:bg-bg-elevated transition-colors group flex items-center gap-3"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-ghost group-hover:text-text-dim shrink-0">
                            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          <div className="min-w-0 flex-1">
                            <span className="text-text-secondary group-hover:text-text-primary text-ui block truncate">{name}</span>
                            <span className="text-text-ghost group-hover:text-text-dim text-label block truncate">{path}</span>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Remove ${name} from recent projects`}
                            onClick={(e) => handleRemoveRecent(e, path)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRemoveRecent(e as unknown as React.MouseEvent, path); } }}
                            className="p-1 rounded-md text-text-ghost opacity-0 group-hover:opacity-100 hover:text-red hover:bg-red/10 transition-all shrink-0"
                          >
                            <X size={14} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
