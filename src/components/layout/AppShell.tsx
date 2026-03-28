import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { showToast } from "../../stores/toastStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useDevServerDetection } from "../../hooks/useDevServerDetection";
import { listen } from "@tauri-apps/api/event";
import { listenPreviewConsoleEntry } from "../../lib/tauri-commands";
import TitleBar from "./TitleBar";
import SessionSubTabs from "./SessionSubTabs";
import Sidebar from "../sidebar/Sidebar";
import ChatPanel from "../chat/ChatPanel";
import ClaudeHistory from "../chat/ClaudeHistory";
import ProjectLogFeed from "../chat/ProjectLogFeed";
import RightPanel from "../rightpanel/RightPanel";
import InputArea from "../input/InputArea";
import ConfirmCloseModal from "../modals/ConfirmCloseModal";
import PreviewUrlDialog from "../modals/PreviewUrlDialog";
import PreviewLoadingModal from "../modals/PreviewLoadingModal";
import type { PendingClose } from "../modals/ConfirmCloseModal";
import SpecWriterSlideOver from "../specwriter/SpecWriterSlideOver";
import HelpPanel from "../help/HelpPanel";
import ImagePreviewModal from "../modals/ImagePreviewModal";
import SuperBroStrip from "../chat/SuperBroStrip";
import { useSuperBro } from "../../hooks/useSuperBro";

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;
      setIsDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        onDrag(delta);
      };

      const onMouseUp = () => {
        dragging.current = false;
        setIsDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [onDrag]
  );

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => { if (!dragging.current) setIsHovering(false); }}
      className="w-[9px] shrink-0 cursor-col-resize flex items-stretch justify-center group"
    >
      <div
        className="w-[1px] transition-all duration-150"
        style={{
          background:
            isDragging
              ? "var(--accent)"
              : isHovering
                ? "var(--accent-light)"
                : "var(--border)",
          opacity: isDragging ? 1 : isHovering ? 0.7 : 0.5,
        }}
      />
    </div>
  );
}

const MIN_CENTER = 300; // minimum center column width in px
const HANDLE_WIDTH = 9; // each resize handle

export default function AppShell() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);
  const rightPanelMinWidth = useUiStore((s) => s.rightPanelMinWidth);
  const showProjectLog = useUiStore((s) => s.showProjectLog);
  const showClaudeHistory = useUiStore((s) => s.showClaudeHistory);
  const setShowProjectLog = useUiStore((s) => s.setShowProjectLog);
  const setShowClaudeHistory = useUiStore((s) => s.setShowClaudeHistory);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const { addSessionToProject, closeSession, closeAllSessionsInProject, renameSession } = useClaudeSession();
  useDevServerDetection();
  useSuperBro(activeProjectPath);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);

  // Subscribe to preview console entries → Activity Feed + toast on errors
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listenPreviewConsoleEntry((entry) => {
      if (cancelled) return;

      // Toast on console.error
      if (entry.level === "error") {
        showToast(`Preview error: ${entry.msg.slice(0, 100)}`, "error");
      }

      // Surface errors and warnings in the Activity Feed
      if (entry.level === "error" || entry.level === "warn") {
        const activeSessionId = useSessionStore.getState().activeSessionId;
        if (activeSessionId) {
          const ts = String(Date.now());
          useActivityStore.getState().addEntry(activeSessionId, {
            id: `preview-${ts}`,
            toolUseId: `preview-console-${ts}`,
            toolName: "preview_console",
            toolInput: { level: entry.level, url: entry.url },
            status: "done",
            timestamp: entry.ts,
            messageId: "",
            result: entry.msg.slice(0, 500),
            isError: entry.level === "error",
          });
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Subscribe to preview console-to-chat events → populate chat input
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<string>("preview-console-to-chat", (e) => {
      if (cancelled) return;
      const formatted = `Browser console logs from preview:\n\`\`\`\n${e.payload}\n\`\`\``;
      useUiStore.getState().setDraftInput(formatted);
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });

    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // Reset project log / history view when switching projects
  useEffect(() => {
    setShowProjectLog(false);
    setShowClaudeHistory(false);
  }, [activeProjectPath, setShowProjectLog, setShowClaudeHistory]);

  const handleCloseSession = useCallback((sessionId: string) => {
    const session = useSessionStore.getState().sessions.get(sessionId);
    setPendingClose({
      type: "session",
      id: sessionId,
      name: session?.name ?? "Session",
      sessionCount: 1,
    });
  }, []);

  const handleCloseProject = useCallback((projectPath: string) => {
    const { sessions, tabOrder } = useSessionStore.getState();
    const count = tabOrder.filter(
      (id) => sessions.get(id)?.project_path === projectPath
    ).length;
    const projectName = projectPath.split("/").filter(Boolean).pop() ?? "";
    setPendingClose({
      type: "project",
      id: projectPath,
      name: projectName,
      sessionCount: count,
    });
  }, []);

  const handleConfirmClose = useCallback(() => {
    if (!pendingClose) return;
    if (pendingClose.type === "session") {
      closeSession(pendingClose.id);
    } else {
      closeAllSessionsInProject(pendingClose.id);
    }
    setPendingClose(null);
  }, [pendingClose, closeSession, closeAllSessionsInProject]);

  // Use getState() to avoid stale closure during drag.
  // Cap widths so the center column never shrinks below MIN_CENTER.
  const handleLeftDrag = useCallback(
    (delta: number) => {
      const state = useUiStore.getState();
      const maxSidebar = window.innerWidth - state.rightPanelWidth - MIN_CENTER - HANDLE_WIDTH * 2;
      const next = Math.min(state.sidebarWidth + delta, maxSidebar);
      state.setSidebarWidth(next);
    },
    []
  );

  const handleRightDrag = useCallback(
    (delta: number) => {
      const state = useUiStore.getState();
      const maxRight = window.innerWidth - state.sidebarWidth - MIN_CENTER - HANDLE_WIDTH * 2;
      const next = Math.min(state.rightPanelWidth - delta, maxRight);
      // setRightPanelWidth already clamps to rightPanelMinWidth
      state.setRightPanelWidth(next);
    },
    []
  );

  return (
    <div className="flex-1 min-h-0 w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <TitleBar onCloseProject={handleCloseProject} />
      <SessionSubTabs
        onAddSession={addSessionToProject}
        onCloseSession={handleCloseSession}
        onRenameSession={renameSession}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div
          className="shrink-0 border-r border-border overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
        </div>

        <ResizeHandle onDrag={handleLeftDrag} />

        {/* Center: Chat + Input or Project Log */}
        <div className="flex-1 flex flex-col min-w-[400px] overflow-hidden pb-3">
          {showProjectLog ? (
            <ProjectLogFeed />
          ) : showClaudeHistory ? (
            <ClaudeHistory />
          ) : (
            <>
              <div className="flex-1 overflow-hidden">
                <ChatPanel />
              </div>
              <InputArea />
              <SuperBroStrip />
            </>
          )}
        </div>

        <ResizeHandle onDrag={handleRightDrag} />

        {/* Right Panel */}
        <div
          className="shrink-0 border-l border-border overflow-hidden pb-3"
          style={{ width: rightPanelWidth, minWidth: rightPanelMinWidth }}
        >
          <RightPanel />
        </div>
      </div>

      <ConfirmCloseModal
        pendingClose={pendingClose}
        onConfirm={handleConfirmClose}
        onCancel={() => setPendingClose(null)}
      />

      <PreviewLoadingModal />
      <PreviewUrlDialog />
      <SpecWriterSlideOver />
      <HelpPanel />
      <ImagePreviewModal />
    </div>
  );
}
