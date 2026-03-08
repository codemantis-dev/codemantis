import { Plus, Settings } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import SessionTab from "./SessionTab";

export default function TitleBar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);
  const setShowProjectPicker = useUiStore((s) => s.setShowProjectPicker);
  const setShowSettingsModal = useUiStore((s) => s.setShowSettingsModal);
  const { closeSession, switchSession, renameSession } = useClaudeSession();

  return (
    <div
      className="h-12 flex items-center border-b border-border select-none"
      data-tauri-drag-region
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Traffic light spacer */}
      <div className="w-[78px] shrink-0" data-tauri-drag-region />

      {/* Session tabs */}
      <div className="flex items-center h-full flex-1 overflow-x-auto overflow-y-hidden" data-tauri-drag-region>
        {tabOrder.map((sessionId) => {
          const session = sessions.get(sessionId);
          if (!session) return null;
          const streaming = sessionStreaming.get(sessionId);
          const projectName = session.project_path
            .split("/")
            .filter(Boolean)
            .pop() ?? "";

          return (
            <SessionTab
              key={sessionId}
              id={sessionId}
              name={session.name}
              projectName={projectName}
              iconIndex={session.icon_index}
              isActive={sessionId === activeSessionId}
              isStreaming={streaming?.isStreaming ?? false}
              onSelect={() => switchSession(sessionId)}
              onClose={() => closeSession(sessionId)}
              onRename={(name) => renameSession(sessionId, name)}
            />
          );
        })}

        {/* Empty drag region if no tabs */}
        {tabOrder.length === 0 && (
          <span className="text-ui text-text-dim px-2" data-tauri-drag-region>
            ClaudeForge
          </span>
        )}
      </div>

      {/* New session button */}
      <button
        onClick={() => setShowProjectPicker(true)}
        title="New session (⌘N)"
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
