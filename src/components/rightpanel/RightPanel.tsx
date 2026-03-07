import { Activity } from "lucide-react";
import ActivityFeed from "./ActivityFeed";

export default function RightPanel() {
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-subtle)" }}>
      {/* Tab header */}
      <div className="h-9 flex items-center px-3 border-b border-border-light shrink-0">
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Activity size={13} />
          <span className="text-ui font-medium">Activity</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <ActivityFeed />
      </div>
    </div>
  );
}
