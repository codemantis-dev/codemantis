import { useState } from "react";
import { Plus, FolderOpen, Blocks, Settings, Globe } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { usePreviewStore } from "../../stores/previewStore";
import { usePreviewWindow } from "../../hooks/usePreviewWindow";
import { usePreviewServer } from "../../hooks/usePreviewServer";
import ProjectTab from "./ProjectTab";

interface TitleBarProps {
  onCloseProject: (projectPath: string) => void;
}

export default function TitleBar({ onCloseProject }: TitleBarProps) {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const projectOrder = useSessionStore((s) => s.projectOrder);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const openProjectPicker = useUiStore((s) => s.openProjectPicker);
  const setShowMcpModal = useUiStore((s) => s.setShowMcpModal);
  const setShowSettingsModal = useUiStore((s) => s.setShowSettingsModal);

  const devServer = usePreviewStore((s) =>
    activeProjectPath ? s.devServer.get(activeProjectPath) : undefined,
  );
  const previewOpen = usePreviewStore((s) =>
    activeProjectPath ? s.previewOpen.get(activeProjectPath) ?? false : false,
  );
  const { openPreview, togglePreview } = usePreviewWindow();
  const { startServer } = usePreviewServer();
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("http://localhost:3000");

  const previewStatus = devServer?.status ?? "idle";

  const handleRunApplication = (): void => {
    if (!activeProjectPath) return;

    if (devServer?.status === "running" && devServer.url) {
      if (previewOpen) {
        togglePreview();
      } else {
        openPreview(devServer.url);
      }
    } else if (devServer?.status === "scanning" || devServer?.status === "starting") {
      // Server is starting, do nothing
    } else {
      // No server running — show URL input or start server
      setShowUrlInput(true);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setShowUrlInput(false);
    if (urlValue.trim()) {
      openPreview(urlValue.trim());
    }
  };

  const handleStartDevServer = (): void => {
    setShowUrlInput(false);
    startServer();
  };

  const globeStatusClass =
    previewStatus === "running"
      ? "text-green-400 animate-pulse"
      : previewStatus === "starting" || previewStatus === "scanning"
        ? "text-yellow-400"
        : previewStatus === "error"
          ? "text-red-400"
          : "text-text-ghost hover:text-text-secondary";

  return (
    <div
      className="h-12 flex items-center border-b border-border select-none"
      data-tauri-drag-region
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Traffic light spacer */}
      <div className="w-[78px] shrink-0" data-tauri-drag-region />

      {/* Project tabs */}
      <div className="flex items-center h-full flex-1 overflow-x-auto overflow-y-hidden" data-tauri-drag-region>
        {projectOrder.map((projectPath) => {
          const projectName = projectPath
            .split("/")
            .filter(Boolean)
            .pop() ?? "";
          const sessionCount = tabOrder.filter((id) => {
            const s = sessions.get(id);
            return s && s.project_path === projectPath;
          }).length;

          return (
            <ProjectTab
              key={projectPath}
              projectPath={projectPath}
              projectName={projectName}
              sessionCount={sessionCount}
              isActive={projectPath === activeProjectPath}
              onSelect={() => setActiveProject(projectPath)}
              onClose={() => onCloseProject(projectPath)}
            />
          );
        })}

        {/* Empty drag region if no tabs */}
        {projectOrder.length === 0 && (
          <span className="text-ui text-text-dim px-2" data-tauri-drag-region>
            CodeMantis
          </span>
        )}
      </div>

      {/* New project button (templates) */}
      <button
        onClick={() => openProjectPicker("templates")}
        title="New project from template (Cmd+Shift+N)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Plus size={15} />
      </button>

      {/* Open existing project */}
      <button
        onClick={() => openProjectPicker("open")}
        title="Open existing project (Cmd+O)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <FolderOpen size={14} />
      </button>

      {/* Run Application / Preview */}
      <div className="relative">
        <button
          onClick={handleRunApplication}
          title="Run Application (Cmd+Shift+P)"
          className={`mx-0.5 p-1.5 rounded-md hover:bg-bg-elevated transition-colors ${globeStatusClass}`}
        >
          <Globe size={14} />
        </button>

        {showUrlInput && (
          <div
            className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border shadow-xl p-3 w-72"
            style={{ background: "var(--bg-primary)" }}
          >
            <form onSubmit={handleUrlSubmit}>
              <label className="text-xs text-text-dim block mb-1.5">
                Preview URL
              </label>
              <input
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="http://localhost:3000"
                autoFocus
                className="w-full px-2 py-1.5 text-sm rounded border border-border bg-bg-elevated text-text-primary focus:outline-none focus:border-accent"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowUrlInput(false);
                }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="submit"
                  className="flex-1 px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90"
                >
                  Open URL
                </button>
                <button
                  type="button"
                  onClick={handleStartDevServer}
                  className="flex-1 px-2 py-1 text-xs rounded border border-border text-text-secondary hover:bg-bg-elevated"
                >
                  Start Dev Server
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* MCP Servers button */}
      <button
        onClick={() => setShowMcpModal(true)}
        title="MCP Servers (Cmd+Shift+M)"
        className="mx-0.5 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Blocks size={14} />
      </button>

      {/* Settings button */}
      <button
        onClick={() => setShowSettingsModal(true)}
        title="Settings (Cmd+,)"
        className="mr-3 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
