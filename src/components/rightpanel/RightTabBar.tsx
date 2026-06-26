/**
 * RightTabBar — the shared right-panel tab strip. Rendered in two places: inside
 * `RightPanel` (normal mode, right column) and at the top of the full-width Duo
 * view (AppShell). Sharing one component keeps the two modes consistent — "Duo"
 * is simply the leftmost tab that relocates with the layout.
 *
 * The tab list + visibility + selection hooks live in `./useRightTabs`.
 */
import type { RightTab } from "../../stores/uiStore";
import type { RightTabDef } from "./useRightTabs";

export function RightTabBar({
  tabs,
  active,
  onSelect,
  compact = false,
  headerRef,
}: {
  tabs: RightTabDef[];
  active: RightTab;
  onSelect: (id: RightTab) => void;
  compact?: boolean;
  headerRef?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
  return (
    <div
      ref={headerRef}
      className="h-9 flex items-center px-1 border-b border-border-light shrink-0 whitespace-nowrap"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        const showLabel = !compact || isActive;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
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
  );
}
