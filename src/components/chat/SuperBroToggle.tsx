import { useCallback } from "react";
import { useSuperBroStore } from "../../stores/superBroStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";

export default function SuperBroToggle() {
  const globalEnabled = useSettingsStore((s) => s.settings.superBroEnabled);
  const session = useSessionStore((s) =>
    s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null,
  );
  const projectPath = session?.project_path ?? null;
  const isEnabled = useSuperBroStore((s) =>
    projectPath ? s.isEnabled(projectPath) : false,
  );
  const toggle = useSuperBroStore((s) => s.toggle);

  const handleToggle = useCallback(() => {
    if (projectPath) toggle(projectPath);
  }, [projectPath, toggle]);

  // Hidden when global setting is OFF
  if (!globalEnabled) return null;

  return (
    <button
      onClick={handleToggle}
      className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
        isEnabled
          ? "text-accent hover:bg-accent/10"
          : "text-text-ghost hover:text-text-dim hover:bg-bg-elevated"
      }`}
      title={
        isEnabled
          ? "Super-Bro is active (click to disable)"
          : "Super-Bro is disabled (click to enable)"
      }
    >
      <span className="text-sm">🧑‍💻</span>
    </button>
  );
}
