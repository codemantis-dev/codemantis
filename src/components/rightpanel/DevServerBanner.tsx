import { Radio } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";
import type { DevServerDetection } from "../../types/terminal";

interface Props {
  currentSessionId: string;
}

interface GroupedServer {
  sessionName: string;
  detections: DevServerDetection[];
}

export default function DevServerBanner({ currentSessionId }: Props) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const sessionTerminals = useTerminalStore((s) => s.sessionTerminals);
  const detectedDevServers = useTerminalStore((s) => s.detectedDevServers);

  // Find all sessions for the same project, excluding current
  const otherSessionIds = tabOrder.filter((id) => {
    if (id === currentSessionId) return false;
    const session = sessions.get(id);
    return session && session.project_path === activeProjectPath;
  });

  // Collect dev server detections from other sessions' terminals
  const grouped: GroupedServer[] = [];

  for (const sessionId of otherSessionIds) {
    const terminals = sessionTerminals.get(sessionId) ?? [];
    const detections: DevServerDetection[] = [];

    for (const terminal of terminals) {
      const servers = detectedDevServers.get(terminal.id) ?? [];
      detections.push(...servers);
    }

    if (detections.length > 0) {
      const session = sessions.get(sessionId);
      grouped.push({
        sessionName: session?.name ?? "Session",
        detections,
      });
    }
  }

  if (grouped.length === 0) return null;

  const handleOpenUrl = (url: string) => {
    openUrl(url).catch((e) => console.error("Failed to open URL:", e));
  };

  return (
    <div
      className="px-3 py-1.5 flex items-center gap-2 text-ui border-b shrink-0"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border-light)",
        color: "var(--text-secondary)",
      }}
    >
      <Radio size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
        {grouped.map((group) => (
          <span key={group.sessionName} className="flex items-center gap-1 min-w-0">
            <span className="truncate" style={{ color: "var(--text-dim)" }}>
              {group.sessionName}
            </span>
            <span style={{ color: "var(--text-faint)" }}>&rarr;</span>
            {group.detections.map((d, i) => (
              <span key={d.port}>
                <button
                  onClick={() => handleOpenUrl(d.url)}
                  className="hover:underline cursor-pointer"
                  style={{ color: "var(--accent)" }}
                  title={`Open ${d.url} in browser`}
                >
                  :{d.port}
                </button>
                {i < group.detections.length - 1 && (
                  <span style={{ color: "var(--text-faint)" }}>,</span>
                )}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
