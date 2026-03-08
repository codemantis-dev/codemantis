import { useCallback, useRef, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import TitleBar from "./TitleBar";
import Sidebar from "../sidebar/Sidebar";
import ChatPanel from "../chat/ChatPanel";
import RightPanel from "../rightpanel/RightPanel";
import InputArea from "../input/InputArea";

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
      state.setRightPanelWidth(next);
    },
    []
  );

  return (
    <div className="h-screen w-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div
          className="shrink-0 border-r border-border overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <Sidebar />
        </div>

        <ResizeHandle onDrag={handleLeftDrag} />

        {/* Center: Chat + Input */}
        <div className="flex-1 flex flex-col min-w-[400px] overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ChatPanel />
          </div>
          <InputArea />
        </div>

        <ResizeHandle onDrag={handleRightDrag} />

        {/* Right Panel */}
        <div
          className="shrink-0 border-l border-border overflow-hidden"
          style={{ width: rightPanelWidth }}
        >
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
