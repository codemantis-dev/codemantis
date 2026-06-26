/**
 * Hooks that build the right-panel tab list, decide when the Duo tab is visible,
 * and route tab selection. Kept separate from the `RightTabBar` component so the
 * component file only exports a component (react-refresh friendly).
 */
import { Activity, TerminalSquare, FileCode, ScrollText, MessageSquare, ListChecks, Users } from "lucide-react";
import { useCallback } from "react";
import { useGuideStore } from "../../stores/guideStore";
import { useDuoStore } from "../../stores/duoStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore, type RightTab } from "../../stores/uiStore";

export interface RightTabDef {
  id: RightTab;
  label: string;
  icon: typeof Activity;
}

/**
 * The Duo view is reachable as the leftmost tab only when a Duo run exists for
 * the CURRENTLY ACTIVE project (or the user explicitly opened Duo for it).
 * Project-scoped, so switching to / opening another project is never blocked.
 */
export function useDuoVisible(): boolean {
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const showDuoDashboard = useUiStore((s) => s.showDuoDashboard);
  const status = useDuoStore((s) => s.status);
  const duoProjectPath = useDuoStore((s) => s.projectPath);
  if (!activeProjectPath) return false;
  const runForThisProject = status !== "idle" && duoProjectPath === activeProjectPath;
  const openedForThisProject =
    showDuoDashboard && (duoProjectPath === null || duoProjectPath === activeProjectPath);
  return runForThisProject || openedForThisProject;
}

/** Ordered right-panel tabs: Duo (leftmost, conditional) … Guide (conditional). */
export function useRightTabs(): RightTabDef[] {
  const hasGuide = useGuideStore((s) => s.guide !== null);
  const duoVisible = useDuoVisible();
  const tabs: RightTabDef[] = [
    { id: "activity", label: "Activity", icon: Activity },
    { id: "terminal", label: "Terminal", icon: TerminalSquare },
    { id: "files", label: "Files", icon: FileCode },
    { id: "changelog", label: "Changelog", icon: ScrollText },
    { id: "assistant", label: "Assistant", icon: MessageSquare },
  ];
  if (hasGuide) tabs.push({ id: "guide", label: "Guide", icon: ListChecks });
  if (duoVisible) tabs.unshift({ id: "duo", label: "Duo", icon: Users });
  return tabs;
}

/**
 * Tab-selection handler shared by both strip locations. Selecting "duo" routes
 * through `openDuo` (marks the view visible + selects it without persisting the
 * transient "duo" choice per session); any other tab uses the normal setter.
 */
export function useRightTabSelect(): (id: RightTab) => void {
  const setRightTab = useUiStore((s) => s.setRightTab);
  const openDuo = useUiStore((s) => s.openDuo);
  return useCallback(
    (id: RightTab) => (id === "duo" ? openDuo() : setRightTab(id)),
    [setRightTab, openDuo],
  );
}
