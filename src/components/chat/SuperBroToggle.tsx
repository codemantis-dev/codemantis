import { useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSuperBroStore } from "../../stores/superBroStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";

export default function SuperBroToggle() {
  const globalEnabled = useSettingsStore((s) => s.settings.superBroEnabled);
  const session = useSessionStore((s) =>
    s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null,
  );
  const projectPath = session?.project_path ?? null;
  const enabledProjects = useSuperBroStore((s) => s.enabledProjects);
  const isEnabled = projectPath ? (enabledProjects.get(projectPath) ?? true) : false;

  const handleToggle = useCallback(() => {
    if (projectPath) useSuperBroStore.getState().toggle(projectPath);
  }, [projectPath]);

  // Hidden when global setting is OFF
  if (!globalEnabled) return null;

  return (
    <button
      onClick={handleToggle}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-label transition-colors ${
        isEnabled
          ? "text-accent hover:bg-accent/10"
          : "text-text-faint hover:text-text-dim hover:bg-bg-subtle line-through decoration-text-ghost"
      }`}
      title={
        isEnabled
          ? "Super-Bro is active (click to disable)"
          : "Super-Bro is disabled (click to enable)"
      }
    >
      {isEnabled ? <Eye size={13} /> : <EyeOff size={13} />}
      <span>Bro</span>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          isEnabled ? "bg-green" : "bg-text-ghost"
        }`}
      />
    </button>
  );
}
