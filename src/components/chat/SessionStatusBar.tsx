import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionActivityInfo } from "../../stores/sessionStore";

function formatElapsedCompact(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}:${remainingMin.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatCostCompact(usd: number): string {
  if (usd < 0.001) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/** Compose a compact activity string for the status bar.
 *  e.g., "Editing settings.ts", "Reading App.tsx", "Running command..." */
function formatActivityDetail(
  activity: SessionActivityInfo | undefined,
  subAgentCount: number,
): string | null {
  if (!activity?.toolName) return null;

  // Agent-aware: show agent count or description
  if (activity.toolName === "Agent") {
    if (subAgentCount > 1) return `${subAgentCount} agents`;
    // Single agent: use the label which already has "Agent: description"
    return activity.label;
  }

  if (activity.filePath) {
    const fileName = activity.filePath.split("/").pop() ?? activity.filePath;
    const verb = activity.label.split(/\s/)[0];
    return `${verb} ${fileName}`;
  }
  return activity.label;
}

interface SessionStatusBarProps {
  sessionId: string;
}

function formatModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  // "claude-opus-4-6-..." → "Opus 4.6", "claude-sonnet-4-..." → "Sonnet 4"
  const stripped = model.replace(/^claude-/, "");
  const parts = stripped.split("-");
  const name = parts[0];
  const version = parts.slice(1).filter((p) => /^\d/.test(p)).join(".");
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
  return version ? `${capitalized} ${version}` : capitalized;
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

  const subAgentCount = subAgents?.filter((a) => a.status === "running").length ?? 0;
  const activityDetail = isBusy ? formatActivityDetail(activity, subAgentCount) : null;

  const totalTokens = stats
    ? stats.totalInputTokens + stats.totalOutputTokens
    : 0;
  const costStr = stats ? formatCostCompact(stats.totalCostUsd) : "";
  const ctxPct = ctx && ctx.max > 0 ? Math.round((ctx.used / ctx.max) * 100) : 0;
  const ctxColor = ctxPct >= 90 ? "text-red" : ctxPct >= 70 ? "text-yellow" : "text-text-ghost";
  const modelLabel = formatModelName(session?.model);
  const turnCount = stats?.turnCount ?? 0;
  const modeLabel = mode === "plan" ? "Plan" : mode === "auto-accept" ? "Auto" : null;

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
            {formatElapsedCompact(elapsed)}
          </span>
        )}
        {activityDetail && (
          <span className="text-text-ghost truncate">{activityDetail}</span>
        )}
      </div>

      <div className="flex-1" />

      {/* Right section: mode + model + turns + RL + tokens + cost + ctx */}
      {modeLabel && (
        <span className="text-yellow font-medium shrink-0">{modeLabel}</span>
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
          {formatTokensCompact(totalTokens)} tokens
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
