import { Plus, Settings } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
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
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const setShowSettingsModal = useUiStore((s) => s.setShowSettingsModal);

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
            ClaudeForge
          </span>
        )}
      </div>

      {/* New project button */}
      <button
        onClick={() => setShowProjectPicker(true)}
        title="New project (⌘⇧N)"
        className="mx-1 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Plus size={15} />
      </button>

      {/* Settings button */}
      <button
        onClick={() => setShowSettingsModal(true)}
        title="Settings (⌘,)"
        className="mr-3 p-1.5 rounded-md text-text-ghost hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
