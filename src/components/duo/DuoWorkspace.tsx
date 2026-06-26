/**
 * DuoWorkspace — the embedded Duo-Coding workspace (replaces the old overlay).
 *
 * Layout: a header (status + run controls), then a body split into a left
 * tabbed area [ Agents | Dashboard ] and a right resizable Orchestrator card.
 * The Agents tab shows the two live agent chats (primary interactive, mentor
 * read-only); the Dashboard tab shows the analyst/metrics; the Orchestrator
 * card shows the mentor's verdicts + decisions/outcomes.
 */
import { useEffect, useState } from "react";
import { Pause, Play, Square, Users } from "lucide-react";
import { useDuoStore } from "../../stores/duoStore";
import { useUiStore } from "../../stores/uiStore";
import DuoAgentSplit from "./DuoAgentSplit";
import DuoDashboard from "./DuoDashboard";
import DuoDialogueView from "./DuoDialogueView";
import DuoTieBreakModal from "./DuoTieBreakModal";
import { useDividerResize } from "../../hooks/useDividerResize";
import type { DuoStatus } from "../../types/duo";

interface Props {
  onConfigure?: () => void;
}

const STATUS_COLOR: Record<DuoStatus, string> = {
  idle: "var(--text-dim)",
  running: "var(--green)",
  paused: "var(--yellow)",
  completed: "var(--blue)",
};

function useElapsed(startedAt: number | null, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return "0:00";
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type WorkspaceTab = "agents" | "dashboard";

export default function DuoWorkspace({ onConfigure }: Props): React.ReactElement {
  const status = useDuoStore((s) => s.status);
  const phase = useDuoStore((s) => s.phase);
  const config = useDuoStore((s) => s.config);
  const startedAt = useDuoStore((s) => s.startedAt);
  const interrupted = useDuoStore((s) => s.interrupted);
  const blocker = useDuoStore((s) => s.blocker);
  const pause = useDuoStore((s) => s.pause);
  const resume = useDuoStore((s) => s.resume);
  const stop = useDuoStore((s) => s.stop);
  const reset = useDuoStore((s) => s.reset);
  const closeDuo = useUiStore((s) => s.closeDuo);

  // Clear the run AND leave the Duo view (removes the tab, returns to Activity).
  const dismiss = (): void => {
    reset();
    closeDuo();
  };

  const [tab, setTab] = useState<WorkspaceTab>("agents");
  const [confirmStop, setConfirmStop] = useState(false);
  const [orchestratorPct, setOrchestratorPct] = useState(32);
  const { dividerRef, isDragging, handleDividerMouseDown } = useDividerResize({
    initialWidth: 32,
    minPct: 20,
    maxPct: 50,
    onWidthChange: (pct) => setOrchestratorPct(100 - pct), // hook reports the LEFT width
  });
  const elapsed = useElapsed(startedAt, status === "running");

  // ── Idle: invite to configure a run ──
  if (status === "idle") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Users size={40} style={{ color: "var(--accent)" }} />
        <div className="max-w-md flex flex-col gap-2">
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Duo-Coding
          </h2>
          <p className="text-detail" style={{ color: "var(--text-secondary)" }}>
            Pair a primary coding agent with a read-only mentor that reviews every
            turn, runs the build/tests itself, and directs repairs — both agents
            visible side by side, with a live dashboard and orchestrator log.
          </p>
        </div>
        <button
          type="button"
          onClick={onConfigure}
          className="px-4 py-2 rounded-md text-detail font-medium"
          style={{ background: "var(--accent)", color: "var(--bg-primary)" }}
        >
          Configure a Duo run
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ── Header / controls ── */}
      <div
        className="flex items-center justify-between gap-4 px-4 py-2 border-b shrink-0 flex-wrap"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-detail font-medium capitalize"
            style={{ color: STATUS_COLOR[status], background: "var(--bg-subtle)" }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
            {status}
          </span>
          {phase && (
            <span className="text-detail capitalize" style={{ color: "var(--text-secondary)" }}>
              {phase}
            </span>
          )}
          {config && (
            <span className="text-detail" style={{ color: "var(--text-dim)" }}>
              {config.primary.agentId}
              {config.primary.model ? `/${config.primary.model}` : ""}
              {" → "}
              {config.duo.agentId}
              {config.duo.model ? `/${config.duo.model}` : ""}
            </span>
          )}
          <span className="text-detail font-mono" style={{ color: "var(--text-dim)" }}>
            {elapsed}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {(interrupted || status === "completed") && (
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
              style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
            >
              <Square size={14} /> Dismiss
            </button>
          )}
          {!interrupted && status === "running" && (
            <button
              type="button"
              onClick={pause}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
              style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {!interrupted && status === "paused" && !blocker && (
            <button
              type="button"
              onClick={() => void resume()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
              style={{ color: "var(--text-primary)", background: "var(--bg-subtle)" }}
            >
              <Play size={14} /> Resume
            </button>
          )}
          {!interrupted &&
            (status === "running" || status === "paused") &&
            (confirmStop ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmStop(false);
                  void stop("stopped-by-user");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail font-medium"
                style={{ color: "var(--bg-primary)", background: "var(--red)" }}
              >
                <Square size={14} /> Confirm stop?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmStop(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-detail"
                style={{ color: "var(--red)", background: "var(--bg-subtle)" }}
              >
                <Square size={14} /> Stop
              </button>
            ))}
        </div>
      </div>

      {interrupted && (
        <div
          className="px-4 py-2 text-detail border-b shrink-0"
          style={{ background: "var(--bg-subtle)", borderColor: "var(--yellow)", color: "var(--text-secondary)" }}
        >
          This run was interrupted by an app restart — its history is shown read-only.
        </div>
      )}

      {/* ── Body: [Agents | Dashboard] tabs + Orchestrator card ── */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col" style={{ width: `${100 - orchestratorPct}%` }}>
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
            {(["agents", "dashboard"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="px-3 py-1 rounded-md text-detail capitalize"
                style={{
                  color: tab === t ? "var(--accent)" : "var(--text-secondary)",
                  background: tab === t ? "var(--bg-subtle)" : "transparent",
                }}
              >
                {t === "agents" ? "Agents" : "Dashboard"}
              </button>
            ))}
          </div>
          {/* Panels (kept mounted; toggled by display so chat scroll/state persists) */}
          <div className="flex-1 min-h-0" style={{ display: tab === "agents" ? "block" : "none" }}>
            <DuoAgentSplit />
          </div>
          <div className="flex-1 min-h-0" style={{ display: tab === "dashboard" ? "block" : "none" }}>
            <DuoDashboard />
          </div>
        </div>

        {/* Resizable divider */}
        <div
          ref={dividerRef}
          onMouseDown={handleDividerMouseDown}
          className="w-1.5 shrink-0 cursor-col-resize"
          style={{ background: isDragging ? "var(--accent)" : "var(--border)" }}
        />

        {/* Orchestrator card */}
        <div
          className="shrink-0 flex flex-col min-h-0 p-2"
          style={{ width: `${orchestratorPct}%` }}
        >
          <span className="text-detail font-semibold px-1 pb-1.5" style={{ color: "var(--text-primary)" }}>
            Orchestrator
          </span>
          <div className="flex-1 min-h-0">
            <DuoDialogueView variant="orchestrator" />
          </div>
        </div>
      </div>

      <DuoTieBreakModal />
    </div>
  );
}
