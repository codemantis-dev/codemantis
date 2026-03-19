import { useEffect, useRef, useCallback, useState } from "react";
import { X } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import PlanningChat from "./PlanningChat";
import WorkPackageList from "./WorkPackageList";
import TaskBoardToolbar from "./TaskBoardToolbar";

export default function TaskBoardSlideOver() {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const uiState = useTaskBoardStore((s) =>
    activeProjectPath ? s.uiState.get(activeProjectPath) ?? null : null
  );
  const setSlideOverOpen = useTaskBoardStore((s) => s.setSlideOverOpen);
  const setPlanningChatWidth = useTaskBoardStore((s) => s.setPlanningChatWidth);
  const { startSession } = useClaudeSession();
  const isOpen = uiState?.is_open ?? false;
  const chatWidth = uiState?.planning_chat_width ?? 40;

  const dividerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleClose = useCallback(() => {
    if (activeProjectPath) {
      setSlideOverOpen(activeProjectPath, false);
    }
  }, [activeProjectPath, setSlideOverOpen]);

  const handleSwitchProject = useCallback(async (newPath: string) => {
    await startSession(newPath);
  }, [startSession]);

  // Escape key closes
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  // Divider drag
  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;
      const containerEl = dividerRef.current?.parentElement;
      if (!containerEl) return;
      const containerWidth = containerEl.getBoundingClientRect().width;
      const startPct = chatWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dPct = (dx / containerWidth) * 100;
        const newPct = Math.max(25, Math.min(65, startPct + dPct));
        if (activeProjectPath) {
          setPlanningChatWidth(activeProjectPath, newPct);
        }
      };

      const onMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [chatWidth, activeProjectPath, setPlanningChatWidth]
  );

  if (!activeProjectPath) return null;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity duration-200"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={handleClose}
        />
      )}

      {/* Slide-over panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-250 ease-out"
        style={{
          width: "60%",
          minWidth: 600,
          maxWidth: "85%",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="h-12 flex items-center justify-between px-4 border-b shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Task Board
          </span>
          <button
            onClick={handleClose}
            title="Close Task Board"
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-ghost)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Two-column content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Planning Chat */}
          <div
            className="overflow-hidden flex flex-col"
            style={{ width: `${chatWidth}%` }}
          >
            <PlanningChat projectPath={activeProjectPath} />
          </div>

          {/* Divider */}
          <div
            ref={dividerRef}
            onMouseDown={handleDividerMouseDown}
            className="w-[5px] shrink-0 cursor-col-resize flex items-stretch justify-center"
          >
            <div
              className="w-px transition-colors"
              style={{
                background: isDragging ? "var(--accent)" : "var(--border)",
              }}
            />
          </div>

          {/* Right: Work Packages */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <WorkPackageList projectPath={activeProjectPath} onSwitchProject={handleSwitchProject} />
          </div>
        </div>

        {/* Bottom toolbar */}
        <TaskBoardToolbar projectPath={activeProjectPath} />
      </div>
    </>
  );
}
