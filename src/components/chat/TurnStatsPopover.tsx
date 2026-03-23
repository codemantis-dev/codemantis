import { useState, useEffect, useRef, useCallback } from "react";
import { BarChart3 } from "lucide-react";
import type { TurnStats } from "../../types/session";
import { formatTokens, formatCost, formatDuration } from "../../lib/format-utils";
import Portal from "../shared/Portal";

interface TurnStatsPopoverProps {
  stats: TurnStats;
}

export default function TurnStatsPopover({ stats }: TurnStatsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheCreationTokens + stats.cacheReadTokens;

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
    });
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) updatePosition();
    setOpen((prev) => !prev);
  }, [open, updatePosition]);

  // Click-outside and Escape handling
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
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
        <Portal>
          <div
            ref={popoverRef}
            className="fixed w-[260px] rounded-lg border border-border p-3 shadow-xl z-50"
            style={{
              background: "var(--bg-primary)",
              left: position.left,
              bottom: position.bottom,
            }}
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
        </Portal>
      )}
    </>
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
