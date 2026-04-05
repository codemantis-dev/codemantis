// ═══════════════════════════════════════════════════════════════════════
// Self-Drive Status Strip — shows in GuidePanel when running/paused/done
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import {
  Pause,
  Play,
  Square,
  ScrollText,
  Wrench,
  CheckCircle2,
  Brain,
  Hammer,
  ShieldCheck,
  TestTube,
  GitCommit,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useSelfDriveStore } from "../../stores/selfDriveStore";
import type { SelfDrivePhase } from "../../types/implementation-guide";
import RunLogViewer from "./RunLogViewer";

const PHASE_CONFIG: Record<SelfDrivePhase, { icon: typeof Hammer; label: string; color: string }> = {
  preparing:       { icon: Loader2,      label: "Preparing...",    color: "var(--text-secondary)" },
  building:        { icon: Hammer,       label: "Building",        color: "var(--accent)" },
  "build-checking": { icon: ShieldCheck, label: "Build check",     color: "var(--accent)" },
  verifying:       { icon: CheckCircle2, label: "Verifying",       color: "var(--accent)" },
  fixing:          { icon: Wrench,       label: "Fixing",          color: "var(--yellow, #eab308)" },
  testing:         { icon: TestTube,     label: "Testing",         color: "var(--accent)" },
  evaluating:      { icon: Brain,        label: "AI deciding...",  color: "var(--purple, #a855f7)" },
  advancing:       { icon: Play,         label: "Advancing",       color: "var(--color-green, #22c55e)" },
  committing:      { icon: GitCommit,    label: "Committing",      color: "var(--accent)" },
};

export default function SelfDriveStatus() {
  const status = useSelfDriveStore((s) => s.status);
  const phase = useSelfDriveStore((s) => s.currentPhase);
  const sessionIndex = useSelfDriveStore((s) => s.currentSessionIndex);
  const fixAttempt = useSelfDriveStore((s) => s.fixAttempt);
  const maxFixAttempts = useSelfDriveStore((s) => s.maxFixAttempts);
  const pauseReason = useSelfDriveStore((s) => s.pauseReason);
  const sessionStartedAt = useSelfDriveStore((s) => s.sessionStartedAt);
  const pause = useSelfDriveStore((s) => s.pause);
  const resume = useSelfDriveStore((s) => s.resume);
  const stop = useSelfDriveStore((s) => s.stop);

  const [showLog, setShowLog] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed timer
  useEffect(() => {
    if (status !== "running" || !sessionStartedAt) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Date.now() - sessionStartedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [status, sessionStartedAt]);

  if (status === "idle") return null;

  const formatElapsed = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  // Completed state
  if (status === "completed") {
    return (
      <div
        className="mx-1 mt-1.5 px-3 py-2 rounded-lg border"
        style={{
          background: "rgba(34, 197, 94, 0.08)",
          borderColor: "var(--color-green, #22c55e)",
        }}
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} style={{ color: "var(--color-green, #22c55e)" }} />
          <span className="text-label font-semibold" style={{ color: "var(--color-green, #22c55e)" }}>
            Self-Drive Complete
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-detail transition-colors hover:bg-bg-elevated"
            style={{ color: "var(--text-secondary)" }}
          >
            <ScrollText size={10} />
            Log
          </button>
        </div>
        {showLog && <RunLogViewer onClose={() => setShowLog(false)} />}
      </div>
    );
  }

  // Paused state
  if (status === "paused") {
    return (
      <div
        className="mx-1 mt-1.5 px-3 py-2 rounded-lg border"
        style={{
          background: "rgba(234, 179, 8, 0.08)",
          borderColor: "var(--yellow, #eab308)",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={14} style={{ color: "var(--yellow, #eab308)" }} />
          <span className="text-label font-semibold" style={{ color: "var(--yellow, #eab308)" }}>
            PAUSED
          </span>
        </div>
        <p className="text-detail mb-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {pauseReason}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={resume}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-detail font-medium transition-colors hover:brightness-95"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Play size={10} />
            Resume
          </button>
          <button
            onClick={stop}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-detail font-medium transition-colors hover:bg-red-500/10"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            <Square size={10} />
            Stop
          </button>
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-detail transition-colors hover:bg-bg-elevated"
            style={{ color: "var(--text-ghost)" }}
          >
            <ScrollText size={10} />
            Log
          </button>
        </div>
        {showLog && <RunLogViewer onClose={() => setShowLog(false)} />}
      </div>
    );
  }

  // Running state
  const phaseConfig = phase ? PHASE_CONFIG[phase] : null;
  const PhaseIcon = phaseConfig?.icon ?? Loader2;
  const isAnimatedIcon = phase === "preparing" || phase === "evaluating";

  return (
    <div
      className="mx-1 mt-1.5 px-3 py-2 rounded-lg border animate-pulse-subtle"
      style={{
        background: "rgba(var(--accent-rgb, 99, 102, 241), 0.06)",
        borderColor: "var(--accent)",
      }}
    >
      <div className="flex items-center gap-2">
        <PhaseIcon
          size={14}
          style={{ color: phaseConfig?.color ?? "var(--accent)" }}
          className={isAnimatedIcon ? "animate-spin" : ""}
        />
        <span className="text-label font-medium" style={{ color: "var(--text-primary)" }}>
          {phaseConfig?.label ?? "Working"} Session {sessionIndex}
          {elapsed > 0 && (
            <span className="ml-1.5 font-normal" style={{ color: "var(--text-ghost)" }}>
              ({formatElapsed(elapsed)})
            </span>
          )}
        </span>
        <div className="flex-1" />
        <button
          onClick={pause}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-detail font-medium transition-colors hover:bg-bg-elevated"
          style={{ color: "var(--text-secondary)" }}
        >
          <Pause size={10} />
          Pause
        </button>
      </div>
      {fixAttempt > 0 && (
        <p className="text-detail mt-0.5" style={{ color: "var(--yellow, #eab308)" }}>
          Fix attempt {fixAttempt}/{maxFixAttempts}
        </p>
      )}
      {showLog && <RunLogViewer onClose={() => setShowLog(false)} />}
    </div>
  );
}
