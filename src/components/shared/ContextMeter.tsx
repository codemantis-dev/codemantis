import type { SessionStats } from "../../types/session";
import { formatTokens, formatCost } from "../../lib/format-utils";

interface ContextMeterProps {
  used: number;
  max: number;
  stats?: SessionStats;
}

export default function ContextMeter({ used, max, stats }: ContextMeterProps) {
  const percentage = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const displayUsed = used >= 1_000_000 ? `${(used / 1_000_000).toFixed(1)}M`
    : used >= 1000 ? `${Math.round(used / 1000)}K` : `${used}`;
  const displayMax = max >= 1_000_000 ? `${(max / 1_000_000).toFixed(0)}M`
    : max >= 1000 ? `${Math.round(max / 1000)}K` : `${max}`;

  let barColor = "bg-accent";
  if (percentage > 90) barColor = "bg-red";
  else if (percentage > 70) barColor = "bg-yellow";

  const hasCost = stats && stats.totalCostUsd > 0;
  const totalTokens = stats
    ? stats.totalInputTokens + stats.totalOutputTokens + stats.totalCacheCreationTokens + stats.totalCacheReadTokens
    : 0;

  return (
    <div className="px-3 py-2">
      {/* Session cost + tokens */}
      {stats && stats.turnCount > 0 && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-label text-text-dim">
            {stats.turnCount} turn{stats.turnCount !== 1 ? "s" : ""}
            {" / "}
            {formatTokens(totalTokens)} tok
          </span>
          {hasCost && (
            <span className="text-label text-text-dim font-mono">
              {formatCost(stats.totalCostUsd, "explicit")}
            </span>
          )}
        </div>
      )}

      {/* Context bar */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-label text-text-dim font-medium tracking-wider uppercase">
          Context
        </span>
        <span className="text-label text-text-faint">
          {displayUsed} / {displayMax}
        </span>
      </div>
      <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
