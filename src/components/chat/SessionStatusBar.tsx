import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Map } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { formatTokens, formatCost, formatDuration, formatModelName } from "../../lib/format-utils";
import { formatActivityDetail } from "../../lib/activity-summary";
import type { SubAgentInfo } from "../../types/activity";

interface SessionStatusBarProps {
  sessionId: string;
}

export default function SessionStatusBar({ sessionId }: SessionStatusBarProps) {
  const isBusy = useSessionStore((s) => s.sessionBusy.get(sessionId) ?? false);
  const isCompacting = useSessionStore((s) => s.sessionCompacting.get(sessionId) ?? false);
  const activity = useSessionStore((s) => s.sessionActivity.get(sessionId));
  const busySince = useSessionStore((s) => s.busySince.get(sessionId));
  const stats = useSessionStore((s) => s.sessionStats.get(sessionId));
  const ctx = useSessionStore((s) => s.sessionContext.get(sessionId));
  const rateLimitUtil = useSessionStore((s) => s.rateLimitUtilization.get(sessionId));
  const subAgents = useSessionStore((s) => s.activeSubAgents.get(sessionId));
  const session = useSessionStore((s) => s.sessions.get(sessionId));
  const mode = useSessionStore((s) => s.sessionModes.get(sessionId));

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busySince) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - busySince);
    const timer = setInterval(() => setElapsed(Date.now() - busySince), 1000);
    return () => clearInterval(timer);
  }, [busySince]);

  // Determine status
  let statusLabel: string;
  let statusColor: string;
  if (isCompacting) {
    statusLabel = "Compacting";
    statusColor = "text-yellow";
  } else if (isBusy) {
    statusLabel = "Busy";
    statusColor = "text-green-400";
  } else {
    statusLabel = "Idle";
    statusColor = "text-text-ghost";
  }

  const activeAgents = useMemo(
    () => subAgents?.filter((a: SubAgentInfo) => a.status === "running" || a.status === "preparing") ?? [],
    [subAgents],
  );
  const subAgentCount = activeAgents.length;
  const activityDetail = isBusy ? formatActivityDetail(activity, subAgentCount) : null;
  const agentTokens = useMemo(
    () => activeAgents.reduce((sum: number, a: SubAgentInfo) => sum + (a.tokenCount ?? 0), 0),
    [activeAgents],
  );

  const totalTokens = stats
    ? stats.totalInputTokens + stats.totalOutputTokens
    : 0;
  const costStr = stats ? formatCost(stats.totalCostUsd, "compact") : "";
  const ctxPct = ctx && ctx.max > 0 ? Math.round((ctx.used / ctx.max) * 100) : 0;
  const ctxColor = ctxPct >= 90 ? "text-red" : ctxPct >= 70 ? "text-yellow" : "text-text-ghost";
  const modelLabel = formatModelName(session?.model);
  const turnCount = stats?.turnCount ?? 0;
  const isAutoAccept = mode === "auto-accept";
  const isPlan = mode === "plan";

  return (
    <div
      className="flex items-center gap-3 px-4 py-1 border-t border-border text-label select-none shrink-0"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Left section: status + elapsed + activity detail */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          isBusy ? "bg-green-400 animate-pulse" : isCompacting ? "bg-yellow animate-pulse" : "bg-text-ghost"
        }`} />
        <span className={`${statusColor} font-medium shrink-0`}>{statusLabel}</span>
        {isBusy && elapsed > 0 && (
          <span className="text-text-ghost font-mono shrink-0">
            {formatDuration(elapsed, "elapsed")}
          </span>
        )}
        {activityDetail && (
          <span className="text-text-ghost truncate">{activityDetail}</span>
        )}
        {isBusy && subAgentCount > 0 && agentTokens > 0 && (
          <span className="text-text-ghost shrink-0">
            ({formatTokens(agentTokens)} agent tokens)
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Right section: mode + model + turns + RL + tokens + cost + ctx */}
      {isAutoAccept && (
        <span className="text-green shrink-0" title="Auto-Accept">
          <ShieldCheck size={14} />
        </span>
      )}
      {isPlan && (
        <span className="text-yellow shrink-0" title="Plan mode">
          <Map size={14} />
        </span>
      )}

      {modelLabel && (
        <span className="text-text-ghost shrink-0">{modelLabel}</span>
      )}

      {/* Turn count */}
      {turnCount > 0 && (
        <span className="text-text-ghost shrink-0">
          {turnCount} {turnCount === 1 ? "turn" : "turns"}
        </span>
      )}

      {/* Rate limit utilization */}
      {rateLimitUtil != null && rateLimitUtil > 0.5 && (
        <span className={`shrink-0 ${rateLimitUtil >= 0.8 ? "text-yellow" : "text-text-ghost"}`}>
          RL {Math.round(rateLimitUtil * 100)}%
        </span>
      )}

      {/* Session tokens */}
      {totalTokens > 0 && (
        <span className="text-text-ghost shrink-0">
          {formatTokens(totalTokens)} tokens
        </span>
      )}

      {/* Cost */}
      {costStr && (
        <span className="text-text-ghost shrink-0">{costStr}</span>
      )}

      {/* Context usage */}
      {ctxPct > 0 && (
        <span className={`shrink-0 ${ctxColor}`}>
          ctx {ctxPct}%
        </span>
      )}
    </div>
  );
}
