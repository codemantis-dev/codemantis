import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, TerminalSquare, FileCode, ScrollText, MessageSquare, ListChecks } from "lucide-react";
import { useUiStore, type RightTab } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useGuideStore } from "../../stores/guideStore";
import { useTerminal } from "../../hooks/useTerminal";
import ActivityFeed from "./ActivityFeed";
import ActivityDetailPanel from "./ActivityDetailPanel";
import TerminalView from "./TerminalView";
import TerminalTabs from "./TerminalTabs";
import QuickCommands from "./QuickCommands";
import FileViewer from "./FileViewer";
import ChangelogFeed from "./ChangelogFeed";
import AssistantPanel from "./AssistantPanel";
import GuidePanel from "./GuidePanel";
import DevServerBanner from "./DevServerBanner";

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

  const hasGuide = useGuideStore((s) => s.guide !== null);

  const setSelectedActivityEntry = useUiStore((s) => s.setSelectedActivityEntry);
  const setRightPanelMinWidth = useUiStore((s) => s.setRightPanelMinWidth);
  const { createTerminal, closeTerminal } = useTerminal();

  // Adaptive icon-only mode: when tabs overflow the container, show icons only
  const [compactMode, setCompactMode] = useState(false);

  // Measure tab buttons' intrinsic width and enforce as right panel minimum.
  // We sum individual button widths rather than reading container scrollWidth,
  // because scrollWidth grows with the container and causes a feedback loop.
  const tabHeaderRef = useRef<HTMLDivElement>(null);
  const lastMinWidth = useRef(0);
  const measureTabWidth = useCallback(() => {
    const el = tabHeaderRef.current;
    if (!el) return;
    let total = 0;
    for (const child of el.children) {
      total += (child as HTMLElement).offsetWidth;
    }
    // Add container horizontal padding (px-1 = 4px each side = 8px) + buffer
    const needed = total + 10;
    // Check if tabs overflow the container
    setCompactMode(total > el.clientWidth);
    // Only update if changed to avoid render loops
    if (needed !== lastMinWidth.current) {
      lastMinWidth.current = needed;
      setRightPanelMinWidth(needed);
    }
  }, [setRightPanelMinWidth]);

  useEffect(() => {
    const el = tabHeaderRef.current;
    if (!el) return;
    // Measure once after mount
    measureTabWidth();
    // Re-measure if font size changes (observed via any child resizing)
    const ro = new ResizeObserver(measureTabWidth);
    for (const child of el.children) {
      ro.observe(child);
    }
    // Also observe the container itself for panel resize
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureTabWidth]);

  // Auto-dismiss activity detail panel on tab change
  useEffect(() => {
    setSelectedActivityEntry(null);
  }, [rightTab, setSelectedActivityEntry]);

  // Fallback: if on "guide" tab but guide was dismissed, switch to activity
  useEffect(() => {
    if (rightTab === "guide" && !hasGuide) {
      setRightTab("activity");
    }
  }, [rightTab, hasGuide, setRightTab]);

  const handleCreateTerminal = async () => {
    if (!activeSessionId) return;
    await createTerminal(activeSessionId);
  };

  const handleCloseTerminal = async (terminalId: string) => {
    if (!activeSessionId) return;
    await closeTerminal(activeSessionId, terminalId);
  };

  const tabs = useMemo(() => {
    const base: { id: RightTab; label: string; icon: typeof Activity }[] = [
      { id: "activity", label: "Activity", icon: Activity },
      { id: "terminal", label: "Terminal", icon: TerminalSquare },
      { id: "files", label: "Files", icon: FileCode },
      { id: "changelog", label: "Changelog", icon: ScrollText },
      { id: "assistant", label: "Assistant", icon: MessageSquare },
    ];
    if (hasGuide) {
      base.push({ id: "guide", label: "Guide", icon: ListChecks });
    }
    return base;
  }, [hasGuide]);

  return (
    <div className="h-full flex flex-col relative" style={{ background: "var(--bg-subtle)" }}>
      {/* Tab header */}
      <div ref={tabHeaderRef} className="h-9 flex items-center px-1 border-b border-border-light shrink-0 whitespace-nowrap">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = rightTab === tab.id;
          const showLabel = !compactMode || isActive;
          return (
            <button
              key={tab.id}
              onClick={() => setRightTab(tab.id)}
              title={tab.label}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-ui transition-colors shrink-0 ${
                isActive
                  ? "text-text-primary bg-bg-elevated font-medium"
                  : "text-text-dim hover:text-text-secondary"
              }`}
            >
              <Icon size={13} />
              {showLabel && <span>{tab.label}</span>}
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

        {activeSessionId && <DevServerBanner currentSessionId={activeSessionId} />}

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

      {/* Guide panel */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        style={{ display: rightTab === "guide" ? "flex" : "none" }}
      >
        <GuidePanel />
      </div>

      {/* Activity detail overlay */}
      <ActivityDetailPanel />
    </div>
  );
}
