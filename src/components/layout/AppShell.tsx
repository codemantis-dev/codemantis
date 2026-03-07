import { useUiStore } from "../../stores/uiStore";
import TitleBar from "./TitleBar";
import Sidebar from "../sidebar/Sidebar";
import ChatPanel from "../chat/ChatPanel";
import RightPanel from "../rightpanel/RightPanel";
import InputArea from "../input/InputArea";

export default function AppShell() {
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);

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

        {/* Center: Chat + Input */}
        <div className="flex-1 flex flex-col min-w-[400px] overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ChatPanel />
          </div>
          <InputArea />
        </div>

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
