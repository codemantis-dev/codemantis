import { useState, useMemo } from "react";
import { Play, Trash2, Package, CheckCircle } from "lucide-react";
import type { TaskPlan } from "../../types/task-board";

interface Props {
  plan: TaskPlan;
  onContinue: () => void;
  onDiscard: () => void;
}

export default function PlanPicker({ plan, onContinue, onDiscard }: Props) {
  const [confirming, setConfirming] = useState(false);

  const stats = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const wp of plan.work_packages) {
      for (const t of wp.tasks) {
        total++;
        if (t.status === "done") done++;
      }
    }
    return { total, done, wpCount: plan.work_packages.length };
  }, [plan]);

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const statusColors: Record<string, string> = {
    planning: "var(--text-dim)",
    ready: "var(--accent)",
    executing: "#eab308",
    done: "#22c55e",
    error: "#ef4444",
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-12 gap-6">
      <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        You have an existing plan for this project
      </div>

      {/* Plan card */}
      <div
        className="w-full max-w-md rounded-lg border p-5 flex flex-col gap-3"
        style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {plan.name}
            </div>
            {plan.description && (
              <div className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-dim)" }}>
                {plan.description}
              </div>
            )}
          </div>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ml-2"
            style={{
              color: statusColors[plan.status] ?? "var(--text-dim)",
              border: `1px solid ${statusColors[plan.status] ?? "var(--border)"}`,
            }}
          >
            {plan.status}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-dim)" }}>
          <span className="flex items-center gap-1">
            <Package size={11} />
            {stats.wpCount} work package{stats.wpCount !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle size={11} />
            {stats.done}/{stats.total} tasks
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full" style={{ background: "var(--bg-elevated)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: pct === 100 ? "#22c55e" : "var(--accent)",
            }}
          />
        </div>

        {plan.created_at && (
          <div className="text-[10px]" style={{ color: "var(--text-ghost)" }}>
            Created {new Date(plan.created_at).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!confirming ? (
        <div className="flex items-center gap-3">
          <button
            onClick={onContinue}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Play size={12} />
            Continue Plan
          </button>
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" }}
          >
            <Trash2 size={12} />
            Discard &amp; Start New
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Archive this plan and start fresh?
          </span>
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 rounded text-xs transition-colors"
            style={{ color: "var(--text-dim)" }}
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{ background: "#ef4444", color: "white" }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
