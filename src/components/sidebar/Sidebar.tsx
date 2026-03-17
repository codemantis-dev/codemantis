import { useEffect, useCallback, useRef } from "react";
import { FolderTree, RefreshCw, FilePlus, FolderPlus } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useFileTree } from "../../hooks/useFileTree";
import { useGitStatus } from "../../hooks/useGitStatus";
import FileTree from "./FileTree";
import type { FileTreeHandle } from "./FileTree";
import GitStatusCard from "./GitStatusCard";
import ContextMeter from "../shared/ContextMeter";
import { getContextWindowForModel } from "../../lib/model-context";
import { useSettingsStore } from "../../stores/settingsStore";

export default function Sidebar() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const sessionContext = useSessionStore((s) => s.sessionContext);
  const sessionStats = useSessionStore((s) => s.sessionStats);

  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const settingsDefault = useSettingsStore.getState().settings.defaultContextWindow;
  const defaultMax = getContextWindowForModel(session?.model, settingsDefault);
  const context = activeSessionId
    ? sessionContext.get(activeSessionId) ?? { used: 0, max: defaultMax }
    : { used: 0, max: defaultMax };
  const stats = activeSessionId
    ? sessionStats.get(activeSessionId) ?? undefined
    : undefined;

  const fileTreeRef = useRef<FileTreeHandle>(null);
  const fileTreeRefreshTrigger = useUiStore((s) => s.fileTreeRefreshTrigger);
  const { files, loading, refresh } = useFileTree();
  const { gitStatus, refresh: refreshGit } = useGitStatus(session?.project_path ?? null);

  const doRefresh = useCallback(() => {
    if (session?.project_path) {
      refresh(session.project_path);
      refreshGit();
    }
  }, [session?.project_path, refresh, refreshGit]);

  // Load on session open
  useEffect(() => {
    doRefresh();
  }, [doRefresh]);

  // Auto-refresh when files are modified by Claude
  useEffect(() => {
    if (fileTreeRefreshTrigger > 0) {
      doRefresh();
    }
  }, [fileTreeRefreshTrigger, doRefresh]);

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-subtle)" }}>
      {/* Tab header */}
      <div
        className="h-9 flex items-center justify-between px-3 border-b border-border-light shrink-0"
        onContextMenu={(e) => {
          e.preventDefault();
          fileTreeRef.current?.openContextMenu(e.clientX, e.clientY);
        }}
      >
        <div className="flex items-center gap-1.5 text-text-secondary">
          <FolderTree size={13} />
          <span className="text-ui font-medium">Files</span>
        </div>
        {session && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => fileTreeRef.current?.startNewFile()}
              className="p-1 rounded text-text-faint hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              title="New file"
            >
              <FilePlus size={12} />
            </button>
            <button
              onClick={() => fileTreeRef.current?.startNewFolder()}
              className="p-1 rounded text-text-faint hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              title="New folder"
            >
              <FolderPlus size={12} />
            </button>
            <button
              onClick={doRefresh}
              className="p-1 rounded text-text-faint hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              title="Refresh file tree"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
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
        {files.length > 0 && session && (
          <FileTree ref={fileTreeRef} nodes={files} projectPath={session.project_path} onRefresh={doRefresh} />
        )}
      </div>

      {/* Git status */}
      {gitStatus?.is_git_repo && (
        <div className="shrink-0 border-t border-border-light">
          <GitStatusCard gitStatus={gitStatus} />
        </div>
      )}

      {/* Context meter */}
      <div className="shrink-0 border-t border-border-light">
        <ContextMeter used={context.used} max={context.max} stats={stats} />
      </div>
    </div>
  );
}
