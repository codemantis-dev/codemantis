import { useMemo } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import type { ActivityEntry } from "../../types/activity";
import { getActivityType } from "../../types/activity";
import StatusDot from "../shared/StatusDot";

interface ActivityChipProps {
  messageId: string;
  sessionId?: string;
}

export default function ActivityChip({ messageId, sessionId }: ActivityChipProps) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionEntries = useActivityStore((s) => s.sessionEntries);
  const effectiveSessionId = sessionId ?? activeSessionId;
  const allEntries: ActivityEntry[] = useMemo(
    () => effectiveSessionId ? sessionEntries.get(effectiveSessionId) ?? [] : [],
    [effectiveSessionId, sessionEntries]
  );
  const entries = useMemo(
    () => allEntries.filter((e) => e.messageId === messageId),
    [allEntries, messageId]
  );

  if (entries.length === 0) return null;

  const counts: Record<string, number> = {};
  let hasRunning = false;

  for (const entry of entries) {
    const type = getActivityType(entry.toolName);
    if (type === "read") counts["reads"] = (counts["reads"] ?? 0) + 1;
    else if (type === "write") counts["created"] = (counts["created"] ?? 0) + 1;
    else if (type === "edit") counts["edited"] = (counts["edited"] ?? 0) + 1;
    else if (type === "bash") counts["commands"] = (counts["commands"] ?? 0) + 1;
    else counts["other"] = (counts["other"] ?? 0) + 1;

    if (entry.status === "running" || entry.status === "pending") {
      hasRunning = true;
    }
  }

  const parts = Object.entries(counts).map(
    ([label, count]) => `${count} ${label}`
  );
  const summary = parts.join(" \u00B7 ");

  return (
    <button className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-label hover:bg-bg-elevated transition-colors">
      <StatusDot
        color={hasRunning ? "yellow" : "green"}
        pulse={hasRunning}
        size={5}
      />
      <span className="text-text-dim">
        {summary}
        {!sessionId && <span className="text-accent-light"> &rarr; Activity</span>}
      </span>
    </button>
  );
}
