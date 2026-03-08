import { useCallback, useRef } from "react";
import { useUiStore } from "../../stores/uiStore";
import TitleBar from "./TitleBar";
import Sidebar from "../sidebar/Sidebar";
import ChatPanel from "../chat/ChatPanel";
import RightPanel from "../rightpanel/RightPanel";
import InputArea from "../input/InputArea";

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;
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
      className="w-[5px] shrink-0 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
    />
  );
}

export default function AppShell() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth);

  const handleLeftDrag = useCallback(
    (delta: number) => setSidebarWidth(sidebarWidth + delta),
    [sidebarWidth, setSidebarWidth]
  );

  const handleRightDrag = useCallback(
    (delta: number) => setRightPanelWidth(rightPanelWidth - delta),
    [rightPanelWidth, setRightPanelWidth]
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
