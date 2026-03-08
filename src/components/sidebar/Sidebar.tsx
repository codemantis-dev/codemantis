import { useEffect } from "react";
import { FolderTree } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useFileTree } from "../../hooks/useFileTree";
import FileTree from "./FileTree";
import ContextMeter from "../shared/ContextMeter";

export default function Sidebar() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionContext = useSessionStore((s) => s.sessionContext);
  const sessionStats = useSessionStore((s) => s.sessionStats);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const context = activeSessionId
    ? sessionContext.get(activeSessionId) ?? { used: 0, max: 200000 }
    : { used: 0, max: 200000 };
  const stats = activeSessionId
    ? sessionStats.get(activeSessionId) ?? undefined
    : undefined;

  const { files, loading, refresh } = useFileTree();

  useEffect(() => {
    if (session?.project_path) {
      refresh(session.project_path);
    }
  }, [session?.project_path, refresh]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-subtle)" }}>
      {/* Tab header */}
      <div className="h-9 flex items-center px-3 border-b border-border-light shrink-0">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <FolderTree size={13} />
          <span className="text-ui font-medium">Files</span>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {!session && (
          <div className="p-4 text-center text-text-faint text-ui">
            No project open
          </div>
        )}
        {session && loading && (
          <div className="p-4 text-center text-text-faint text-ui">
            Loading...
          </div>
        )}
        {session && !loading && files.length === 0 && (
          <div className="p-4 text-center text-text-faint text-ui">
            Empty directory
          </div>
        )}
        {files.length > 0 && <FileTree nodes={files} />}
      </div>

      {/* Context meter */}
      <div className="shrink-0 border-t border-border-light">
        <ContextMeter used={context.used} max={context.max} stats={stats} />
      </div>
    </div>
  );
}
