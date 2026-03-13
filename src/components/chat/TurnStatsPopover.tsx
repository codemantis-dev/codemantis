import { useState } from "react";
import { BarChart3 } from "lucide-react";
import type { TurnStats } from "../../types/session";
import { formatTokens, formatCost, formatDuration } from "../../lib/format-utils";
import { useClickOutside } from "../../hooks/useClickOutside";

interface TurnStatsPopoverProps {
  stats: TurnStats;
}

export default function TurnStatsPopover({ stats }: TurnStatsPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheCreationTokens + stats.cacheReadTokens;

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-label text-text-ghost hover:text-text-dim hover:bg-bg-elevated transition-colors"
        title="Turn context"
      >
        <BarChart3 size={11} />
        <span>{formatTokens(totalTokens)} tokens</span>
        {stats.costUsd != null && stats.costUsd > 0 && (
          <span className="text-text-ghost">{formatCost(stats.costUsd)}</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-[260px] rounded-lg border border-border p-3 shadow-xl z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="text-ui font-medium text-text-primary mb-2">Turn Context</div>

          <div className="space-y-1.5">
            {/* Duration */}
            {stats.durationMs != null && (
              <Row label="Duration" value={formatDuration(stats.durationMs, "short")} />
            )}
            {stats.durationApiMs != null && stats.durationApiMs > 0 && (
              <Row label="API time" value={formatDuration(stats.durationApiMs, "short")} />
            )}

            {/* API calls */}
            {stats.numTurns != null && stats.numTurns > 0 && (
              <Row label="API calls" value={`${stats.numTurns}`} />
            )}

            {/* Cost */}
            {stats.costUsd != null && stats.costUsd > 0 && (
              <Row label="Cost" value={formatCost(stats.costUsd)} />
            )}

            {/* Separator */}
            <div className="border-t border-border-light my-1.5" />

            {/* Token breakdown */}
            <Row label="Input tokens" value={formatTokens(stats.inputTokens)} />
            <Row label="Output tokens" value={formatTokens(stats.outputTokens)} />
            {stats.cacheReadTokens > 0 && (
              <Row label="Cache read" value={formatTokens(stats.cacheReadTokens)} />
            )}
            {stats.cacheCreationTokens > 0 && (
              <Row label="Cache write" value={formatTokens(stats.cacheCreationTokens)} />
            )}

            <div className="border-t border-border-light my-1.5" />
            <Row label="Total tokens" value={formatTokens(totalTokens)} bold />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-label ${bold ? "text-text-secondary font-medium" : "text-text-dim"}`}>
        {label}
      </span>
      <span className={`text-label font-mono ${bold ? "text-text-primary font-medium" : "text-text-secondary"}`}>
        {value}
      </span>
    </div>
  );
}
