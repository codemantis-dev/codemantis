/**
 * DuoTieBreakModal — surfaces a paused run that needs a human decision:
 * a primary↔mentor deadlock, or a budget-cap pause. The user picks the
 * resolution. Renders nothing unless the run is paused on a blocker.
 */
import { AlertTriangle } from "lucide-react";
import { useDuoStore } from "../../stores/duoStore";

export default function DuoTieBreakModal(): React.ReactElement | null {
  const status = useDuoStore((s) => s.status);
  const blocker = useDuoStore((s) => s.blocker);
  const resolveTieBreak = useDuoStore((s) => s.resolveTieBreak);
  const stop = useDuoStore((s) => s.stop);

  if (status !== "paused" || !blocker) return null;

  const isBudget = blocker.summary.startsWith("Budget");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg rounded-lg border shadow-xl"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--yellow)" }} />
          <span className="text-ui font-semibold" style={{ color: "var(--text-primary)" }}>
            {isBudget ? "Budget cap reached" : "Run paused — your decision needed"}
          </span>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
            {blocker.summary}
          </p>

          {!isBudget && (
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-md border p-3"
                style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
              >
                <div className="text-detail font-medium mb-1" style={{ color: "var(--blue)" }}>
                  Primary&apos;s position
                </div>
                <div className="text-detail" style={{ color: "var(--text-secondary)" }}>
                  {blocker.primaryPosition}
                </div>
              </div>
              <div
                className="rounded-md border p-3"
                style={{ background: "var(--bg-subtle)", borderColor: "var(--border)" }}
              >
                <div className="text-detail font-medium mb-1" style={{ color: "var(--yellow)" }}>
                  Mentor&apos;s position
                </div>
                <div className="text-detail" style={{ color: "var(--text-secondary)" }}>
                  {blocker.duoPosition}
                </div>
              </div>
            </div>
          )}

          {blocker.repairTask && (
            <div className="text-detail" style={{ color: "var(--text-dim)" }}>
              Proposed fix: {blocker.repairTask}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => void stop("stopped-at-tiebreak")}
            className="px-3 py-1.5 rounded-md text-detail"
            style={{ color: "var(--red)", background: "var(--bg-subtle)" }}
          >
            Stop the run
          </button>
          {!isBudget && (
            <>
              <button
                type="button"
                onClick={() => void resolveTieBreak("primaryWins")}
                className="px-3 py-1.5 rounded-md text-detail"
                style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
              >
                Let primary proceed
              </button>
              <button
                type="button"
                onClick={() => void resolveTieBreak("mentorWins")}
                className="px-3 py-1.5 rounded-md text-detail font-medium"
                style={{ color: "var(--bg-primary)", background: "var(--accent)" }}
              >
                Let mentor win
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
