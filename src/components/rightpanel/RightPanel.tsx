import { useEffect } from "react";
import { Activity, TerminalSquare, FileCode, ScrollText, MessageSquare } from "lucide-react";
import { useUiStore, type RightTab } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useTerminal } from "../../hooks/useTerminal";
import ActivityFeed from "./ActivityFeed";
import ActivityDetailPanel from "./ActivityDetailPanel";
import TerminalView from "./TerminalView";
import TerminalTabs from "./TerminalTabs";
import QuickCommands from "./QuickCommands";
import FileViewer from "./FileViewer";
import ChangelogFeed from "./ChangelogFeed";
import AssistantPanel from "./AssistantPanel";

export default function RightPanel() {
  const rightTab = useUiStore((s) => s.rightTab);
  const setRightTab = useUiStore((s) => s.setRightTab);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const sessionTerminals = useTerminalStore((s) => s.sessionTerminals);
  const activeTerminalIdMap = useTerminalStore((s) => s.activeTerminalId);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);

  const allTerminals = activeSessionId ? sessionTerminals.get(activeSessionId) ?? [] : [];
  const terminals = allTerminals.filter((t) => t.kind !== "cli-overlay");
  const activeTerminalId = activeSessionId ? activeTerminalIdMap.get(activeSessionId) ?? null : null;

  const setSelectedActivityEntry = useUiStore((s) => s.setSelectedActivityEntry);
  const { createTerminal, closeTerminal } = useTerminal();

  // Auto-dismiss activity detail panel on tab change
  useEffect(() => {
    setSelectedActivityEntry(null);
  }, [rightTab, setSelectedActivityEntry]);

  const handleCreateTerminal = async () => {
    if (!activeSessionId) return;
    await createTerminal(activeSessionId);
  };

  const handleCloseTerminal = async (terminalId: string) => {
    if (!activeSessionId) return;
    await closeTerminal(activeSessionId, terminalId);
  };

  const tabs: { id: RightTab; label: string; icon: typeof Activity }[] = [
    { id: "activity", label: "Activity", icon: Activity },
    { id: "terminal", label: "Terminal", icon: TerminalSquare },
    { id: "files", label: "Files", icon: FileCode },
    { id: "changelog", label: "Changelog", icon: ScrollText },
    { id: "assistant", label: "Assistant", icon: MessageSquare },
  ];

  return (
    <div className="h-full flex flex-col relative" style={{ background: "var(--bg-subtle)" }}>
      {/* Tab header */}
      <div className="h-9 flex items-center px-1 border-b border-border-light shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setRightTab(tab.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-ui transition-colors ${
                rightTab === tab.id
                  ? "text-text-primary bg-bg-elevated font-medium"
                  : "text-text-dim hover:text-text-secondary"
              }`}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Activity panel */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: rightTab === "activity" ? "block" : "none" }}
      >
        <ActivityFeed />
      </div>

      {/* Terminal panel */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        style={{ display: rightTab === "terminal" ? "flex" : "none" }}
      >
        {terminals.length > 0 && (
          <TerminalTabs
            terminals={terminals}
            activeTerminalId={activeTerminalId}
            onSelect={(id) => activeSessionId && setActiveTerminal(activeSessionId, id)}
            onClose={handleCloseTerminal}
            onCreate={handleCreateTerminal}
          />
        )}

        <div className="flex-1 relative overflow-hidden">
          {terminals.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-2">
              <p className="text-text-faint text-ui">No terminals</p>
              <button
                onClick={handleCreateTerminal}
                disabled={!activeSessionId}
                className="px-3 py-1.5 rounded-lg text-ui text-accent hover:bg-accent/10 transition-colors"
              >
                Create Terminal
              </button>
            </div>
          )}

          {/* Render ALL terminals across all sessions to preserve xterm state */}
          {Array.from(sessionTerminals.entries()).flatMap(([sessionId, terms]) =>
            terms
              .filter((t) => t.kind !== "cli-overlay")
              .map((terminal) => (
                <TerminalView
                  key={terminal.id}
                  terminalId={terminal.id}
                  isVisible={sessionId === activeSessionId && terminal.id === activeTerminalId}
                />
              ))
          )}
        </div>

        {terminals.length > 0 && (
          <QuickCommands terminalId={activeTerminalId} />
        )}
      </div>

      {/* File viewer panel */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: rightTab === "files" ? "block" : "none" }}
      >
        <FileViewer />
      </div>

      {/* Changelog panel */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: rightTab === "changelog" ? "block" : "none" }}
      >
        <ChangelogFeed />
      </div>

      {/* Assistant panel */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        style={{ display: rightTab === "assistant" ? "flex" : "none" }}
      >
        <AssistantPanel />
      </div>

      {/* Activity detail overlay */}
      <ActivityDetailPanel />
    </div>
  );
}
