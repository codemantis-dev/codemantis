import { useMemo, useState, useEffect } from "react";
import { Activity, AlertTriangle, ShieldAlert } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useActivityStore } from "../../stores/activityStore";
import { useUiStore } from "../../stores/uiStore";
import { useClickOutside } from "../../hooks/useClickOutside";
import StatusDot from "../shared/StatusDot";
import { formatActivityDetail } from "../../lib/activity-summary";
import { formatDuration } from "../../lib/format-utils";

type RunState = "working" | "stuck" | "approval" | "compacting";

interface OverviewRow {
  sessionId: string;
  name: string;
  state: RunState;
  detail: string;
  elapsedMs: number;
}

interface OverviewProject {
  path: string;
  name: string;
  busyCount: number;
  rows: OverviewRow[];
}

function projectNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function RowIcon({ state }: { state: RunState }) {
  if (state === "stuck") {
    return <AlertTriangle size={13} className="text-yellow shrink-0" />;
  }
  if (state === "approval") {
    return <ShieldAlert size={13} className="text-yellow shrink-0" />;
  }
  return <StatusDot color={state === "compacting" ? "yellow" : "green"} pulse size={6} />;
}

/**
 * Activity Overview — a top-left toolbar control (the pulsing Activity icon)
 * that opens an anchored dropdown listing every project/session currently
 * running a job or needing attention (stuck / awaiting approval), with a
 * one-line "what it's doing now" and a live elapsed timer. Clicking a row
 * jumps straight to that session (and its project tab); clicking a project
 * header jumps to the project. Closes on click-outside / Escape.
 *
 * The trigger button lives inside this component (wrapped in the same
 * click-outside container as the panel) so toggling it never races the
 * outside-click handler.
 */
export default function ActivityOverview() {
  const open = useUiStore((s) => s.showActivityOverview);
  const setOpen = useUiStore((s) => s.setShowActivityOverview);

  const projectOrder = useSessionStore((s) => s.projectOrder);
  const sessions = useSessionStore((s) => s.sessions);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const sessionBusy = useSessionStore((s) => s.sessionBusy);
  const sessionStuck = useSessionStore((s) => s.sessionStuck);
  const sessionCompacting = useSessionStore((s) => s.sessionCompacting);
  const sessionActivity = useSessionStore((s) => s.sessionActivity);
  const busySince = useSessionStore((s) => s.busySince);
  const activeSubAgents = useSessionStore((s) => s.activeSubAgents);
  const approvalQueue = useActivityStore((s) => s.approvalQueue);

  // Total active sessions across all projects — the count shown on the icon
  // badge even when the panel is closed.
  const totalActive = useSessionStore((s) => {
    let n = 0;
    for (const id of s.tabOrder) if (s.sessionBusy.get(id)) n++;
    return n;
  });

  // Tick once a second while open so the elapsed timers stay live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const approvalSessions = useMemo(
    () => new Set(approvalQueue.map((a) => a.sessionId)),
    [approvalQueue],
  );

  const projects = useMemo<OverviewProject[]>(() => {
    if (!open) return [];
    const result: OverviewProject[] = [];
    for (const path of projectOrder) {
      const rows: OverviewRow[] = [];
      let busyCount = 0;
      for (const id of tabOrder) {
        const session = sessions.get(id);
        if (!session || session.project_path !== path) continue;

        const busy = sessionBusy.get(id) ?? false;
        const stuck = !!sessionStuck.get(id);
        const compacting = sessionCompacting.get(id) ?? false;
        const awaiting = approvalSessions.has(id);

        // Skip pure-idle sessions — the overview only lists active or
        // attention-needing work.
        if (!busy && !stuck && !compacting && !awaiting) continue;
        if (busy) busyCount++;

        const since = busySince.get(id);
        const elapsedMs = since ? Math.max(0, now - since) : 0;

        let state: RunState;
        let detail: string;
        if (awaiting) {
          state = "approval";
          detail = "Needs approval";
        } else if (stuck) {
          state = "stuck";
          detail = "No progress — may be stuck";
        } else if (compacting) {
          state = "compacting";
          detail = "Compacting context…";
        } else {
          state = "working";
          const subAgentCount = (activeSubAgents.get(id) ?? []).filter(
            (a) => a.status === "running" || a.status === "preparing",
          ).length;
          detail = formatActivityDetail(sessionActivity.get(id), subAgentCount) ?? "Thinking…";
        }

        rows.push({ sessionId: id, name: session.name, state, detail, elapsedMs });
      }
      if (rows.length > 0) {
        result.push({ path, name: projectNameFromPath(path), busyCount, rows });
      }
    }
    return result;
  }, [
    open,
    projectOrder,
    tabOrder,
    sessions,
    sessionBusy,
    sessionStuck,
    sessionCompacting,
    approvalSessions,
    busySince,
    activeSubAgents,
    sessionActivity,
    now,
  ]);

  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false), {
    closeOnEscape: true,
  });

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Activity Overview"
        aria-expanded={open}
        title="Activity Overview (⌘⇧O)"
        className={`relative ml-1 mr-0.5 p-1.5 rounded-md transition-colors ${
          open
            ? "text-accent bg-accent-dim"
            : "text-text-ghost hover:text-text-secondary hover:bg-bg-elevated"
        }`}
      >
        <Activity size={15} className={totalActive > 0 && !open ? "animate-pulse" : ""} />
        {totalActive > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
            style={{ background: "var(--green)" }}
          >
            {totalActive}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-[340px] rounded-lg border border-border shadow-lg overflow-hidden z-50"
          style={{ background: "var(--bg-primary)" }}
        >
          <div className="px-3 py-2 border-b border-border-light flex items-center gap-2">
            <Activity size={13} className="text-text-dim" />
            <span className="text-ui font-semibold text-text-primary">Activity Overview</span>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
            {projects.length === 0 ? (
              <div className="px-3 py-6 text-center text-label text-text-dim">No active jobs</div>
            ) : (
              projects.map((project) => (
                <div key={project.path}>
                  <button
                    type="button"
                    onClick={() => {
                      useSessionStore.getState().setActiveProject(project.path);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-subtle/50 transition-colors"
                  >
                    <StatusDot color="green" pulse size={5} />
                    <span className="text-label font-medium text-text-secondary truncate flex-1">
                      {project.name}
                    </span>
                    {project.busyCount > 0 && (
                      <span className="text-detail text-text-ghost shrink-0">
                        {project.busyCount} working
                      </span>
                    )}
                  </button>

                  {project.rows.map((row) => (
                    <button
                      key={row.sessionId}
                      type="button"
                      onClick={() => {
                        useSessionStore.getState().setActiveSession(row.sessionId);
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left hover:bg-bg-subtle transition-colors"
                    >
                      <RowIcon state={row.state} />
                      <div className="min-w-0 flex-1">
                        <div className="text-label text-text-primary truncate">{row.name}</div>
                        <div className="text-detail text-text-ghost truncate">{row.detail}</div>
                      </div>
                      {row.elapsedMs > 0 && (
                        <span className="text-detail text-text-ghost font-mono shrink-0">
                          {formatDuration(row.elapsedMs, "elapsed")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
