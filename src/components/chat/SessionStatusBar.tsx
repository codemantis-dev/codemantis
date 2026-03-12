import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";

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
    statusColor = "text-yellow-400";
  } else if (isBusy) {
    statusLabel = activity?.label?.replace("...", "") ?? "Working";
    statusColor = "text-green-400";
  } else {
    statusLabel = "Idle";
    statusColor = "text-text-ghost";
  }

  const totalTokens = stats
    ? stats.totalInputTokens + stats.totalOutputTokens
    : 0;
  const costStr = stats ? formatCostCompact(stats.totalCostUsd) : "";
  const ctxPct = ctx && ctx.max > 0 ? Math.round((ctx.used / ctx.max) * 100) : 0;
  const ctxColor = ctxPct >= 90 ? "text-red" : ctxPct >= 70 ? "text-yellow-400" : "text-text-ghost";

  return (
    <div
      className="flex items-center gap-3 px-4 py-1 border-t border-border text-label select-none shrink-0"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${
          isBusy ? "bg-green-400 animate-pulse" : isCompacting ? "bg-yellow-400 animate-pulse" : "bg-text-ghost"
        }`} />
        <span className={`${statusColor} font-medium`}>{statusLabel}</span>
      </div>

      {/* Elapsed time when busy */}
      {isBusy && elapsed > 0 && (
        <span className="text-text-ghost font-mono">
          {formatElapsedCompact(elapsed)}
        </span>
      )}

      <div className="flex-1" />

      {/* Rate limit utilization */}
      {rateLimitUtil != null && rateLimitUtil > 0.5 && (
        <span className={rateLimitUtil >= 0.8 ? "text-yellow-400" : "text-text-ghost"}>
          RL {Math.round(rateLimitUtil * 100)}%
        </span>
      )}

      {/* Session tokens */}
      {totalTokens > 0 && (
        <span className="text-text-ghost">
          {formatTokensCompact(totalTokens)} tokens
        </span>
      )}

      {/* Cost */}
      {costStr && (
        <span className="text-text-ghost">{costStr}</span>
      )}

      {/* Context usage */}
      {ctxPct > 0 && (
        <span className={ctxColor}>
          ctx {ctxPct}%
        </span>
      )}
    </div>
  );
}
