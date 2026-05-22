import { useEffect, useState } from "react";
import { agentUsageBreakdown, type AgentUsageEntry } from "../../../lib/tauri-commands";

/**
 * v1.5.0 Phase 1 — cost-transparency widget for the Agents settings tab.
 *
 * CLI sessions are subscription-billed (Codex via the user's ChatGPT
 * plan; Claude via Pro/Max or — after 15 Jun 2026 — the metered
 * Agent-SDK pool). There is no honest per-session dollar figure, so
 * this shows the *session-count split* over the last 7 days — a real,
 * verifiable signal of how per-task routing is shifting work between
 * the two pools.
 */

const WINDOW_DAYS = 7;

const AGENT_LABEL: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
};

export default function AgentCostBreakdown(): React.ReactElement {
  const [rows, setRows] = useState<AgentUsageEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void agentUsageBreakdown(WINDOW_DAYS)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="text-label text-text-ghost">
        Usage breakdown unavailable.
      </p>
    );
  }

  if (rows === null) {
    return <p className="text-label text-text-ghost">Loading usage…</p>;
  }

  const total = rows.reduce((sum, r) => sum + r.sessionCount, 0);

  if (total === 0) {
    return (
      <p className="text-label text-text-ghost">
        No sessions in the last {WINDOW_DAYS} days yet — the split will
        appear here once you've run a few.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="agent-cost-breakdown">
      {rows.map((r) => {
        const pct = Math.round((r.sessionCount / total) * 100);
        const label = AGENT_LABEL[r.agentId] ?? r.agentId;
        const note =
          r.agentId === "codex"
            ? "ChatGPT subscription"
            : "Pro/Max · metered headless after 15 Jun 2026";
        return (
          <div key={r.agentId} className="flex items-center gap-2 text-label">
            <span className="w-24 shrink-0 text-text-secondary">{label}</span>
            <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-text-secondary tabular-nums">
              {pct}%
            </span>
            <span className="w-56 shrink-0 text-text-ghost">{note}</span>
          </div>
        );
      })}
    </div>
  );
}
