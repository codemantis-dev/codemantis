import { useSessionStore } from "../../stores/sessionStore";
import StatusDot from "../shared/StatusDot";

export default function TitleBar() {
  const session = useSessionStore((s) => s.session);
  const isStreaming = useSessionStore((s) => s.isStreaming);

  return (
    <div
      className="h-12 flex items-center border-b border-border select-none"
      data-tauri-drag-region
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Traffic light spacer */}
      <div className="w-[78px] shrink-0" data-tauri-drag-region />

      {/* Session info */}
      <div className="flex items-center gap-2 flex-1" data-tauri-drag-region>
        {session ? (
          <>
            <StatusDot
              color={isStreaming ? "yellow" : "green"}
              pulse={isStreaming}
            />
            <span className="text-ui text-text-primary font-medium truncate">
              {session.name}
            </span>
            {session.model && (
              <span className="text-label text-text-faint">
                {session.model}
              </span>
            )}
          </>
        ) : (
          <span className="text-ui text-text-dim">ClaudeForge</span>
        )}
      </div>
    </div>
  );
}
