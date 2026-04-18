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
  LifeBuoy,
  Loader2,
} from "lucide-react";
import { useSelfDriveStore, useBlockerHasResolution } from "../../stores/selfDriveStore";
import CopyButton from "../shared/CopyButton";
import { useSessionStore } from "../../stores/sessionStore";
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
  recovering:      { icon: LifeBuoy,     label: "Recovering",      color: "var(--yellow, #eab308)" },
};

export default function SelfDriveStatus() {
  const sdProjectPath = useSelfDriveStore((s) => s.projectPath);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const status = useSelfDriveStore((s) => s.status);
  const phase = useSelfDriveStore((s) => s.currentPhase);
  const sessionIndex = useSelfDriveStore((s) => s.currentSessionIndex);
  const fixAttempt = useSelfDriveStore((s) => s.fixAttempt);
  const maxFixAttempts = useSelfDriveStore((s) => s.maxFixAttempts);
  const pauseReason = useSelfDriveStore((s) => s.pauseReason);
  const activeBlocker = useSelfDriveStore((s) => s.activeBlocker);
  const hasResolution = useBlockerHasResolution();
  const needsSessionAttach = useSelfDriveStore((s) => s.needsSessionAttach);
  const attachSession = useSelfDriveStore((s) => s.attachSession);
  // Compute the "current" session in Self-Drive's project so we can offer
  // a one-click attach. User must have already clicked into the target
  // session tab (explicit action — no auto-select).
  const attachCandidateSessionId = useSessionStore((s) => {
    const sdProject = useSelfDriveStore.getState().projectPath;
    if (!sdProject) return null;
    return s.projectActiveSession.get(sdProject) ?? null;
  });
  const sessionStartedAt = useSelfDriveStore((s) => s.sessionStartedAt);
  const pause = useSelfDriveStore((s) => s.pause);
  const resume = useSelfDriveStore((s) => s.resume);
  const stop = useSelfDriveStore((s) => s.stop);

  const lastPrompt = useSelfDriveStore((s) => {
    for (let i = s.runLog.length - 1; i >= 0; i--) {
      if (s.runLog[i].prompt) return s.runLog[i].prompt!;
    }
    return null;
  });

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

  // Don't show Self-Drive status for a different project
  if (status === "idle" || sdProjectPath !== activeProjectPath) return null;

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
    // Disable Resume when a blocker is waiting on an answer, OR when the
    // Self-Drive run is freshly hydrated from disk and hasn't been
    // re-attached to a live Claude Code session yet.
    const blockedOnAnswer = !!activeBlocker && !hasResolution;
    const resumeDisabled = blockedOnAnswer || needsSessionAttach;
    const resumeTitle = needsSessionAttach
      ? "Attach a Claude Code session first."
      : blockedOnAnswer
        ? "Pick an option on the blocker card above, or answer in the main chat."
        : "Resume Self-Drive";

    // Plain-text snapshot for the Copy button. Rebuilt on each click via
    // the lazy getText callback so the latest pauseReason is captured.
    const buildPausedText = (): string => {
      const lines: string[] = ["PAUSED"];
      if (activeBlocker) {
        if (activeBlocker.summary) lines.push(activeBlocker.summary);
        if (activeBlocker.resolutionCriteria) {
          lines.push(`Resolution criteria: ${activeBlocker.resolutionCriteria}`);
        }
      }
      if (pauseReason && pauseReason !== activeBlocker?.summary) {
        lines.push(pauseReason);
      }
      return lines.filter((l) => l.trim().length > 0).join("\n\n");
    };

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
            {needsSessionAttach ? "RESTART RECOVERY — ATTACH A SESSION" : "PAUSED"}
          </span>
          <div className="flex-1" />
          <CopyButton getText={buildPausedText} label="Copy pause message" size={12} />
        </div>

        {needsSessionAttach && (
          <div className="select-text mb-2">
            <p className="text-detail leading-relaxed" style={{ color: "var(--text-primary)" }}>
              Self-Drive was running when CodeMantis restarted. The previously
              pinned Claude Code session ended with the app. Open (or click into)
              a session in this project, then click <span className="font-semibold">Attach current session</span>.
              Resume will then re-run the diagnostic evidence against live state.
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                onClick={() => {
                  if (attachCandidateSessionId) {
                    void attachSession(attachCandidateSessionId);
                  }
                }}
                disabled={!attachCandidateSessionId}
                title={
                  attachCandidateSessionId
                    ? "Bind Self-Drive to the currently active session in this project."
                    : "Click into a Claude Code session tab in this project first."
                }
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-detail font-medium transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: "var(--yellow, #eab308)", color: "var(--bg-primary)" }}
              >
                <Play size={10} />
                Attach current session
              </button>
            </div>
          </div>
        )}

        <div className="select-text">
          {activeBlocker ? (
            <>
              <p className="text-detail leading-relaxed font-medium" style={{ color: "var(--text-primary)" }}>
                {activeBlocker.summary}
              </p>
              <p
                className="text-detail mt-0.5 leading-relaxed"
                style={{ color: blockedOnAnswer ? "var(--yellow, #eab308)" : "var(--text-secondary)" }}
              >
                {blockedOnAnswer
                  ? "Waiting for your decision — pick an option above or answer in chat, then Resume."
                  : "Answer captured — click Resume to verify and continue."}
              </p>
              {pauseReason && pauseReason !== activeBlocker.summary && (
                <p className="text-detail mt-1 mb-2 leading-relaxed" style={{ color: "var(--text-ghost)" }}>
                  {pauseReason}
                </p>
              )}
            </>
          ) : (
            <p className="text-detail mb-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {pauseReason}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          <button
            onClick={resume}
            disabled={resumeDisabled}
            title={resumeTitle}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-detail font-medium transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
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
      {lastPrompt && (
        <p
          className="text-detail mt-0.5 truncate"
          style={{ color: "var(--text-ghost)" }}
          title={lastPrompt}
        >
          {lastPrompt.length > 80 ? `${lastPrompt.slice(0, 80)}...` : lastPrompt}
        </p>
      )}
      {showLog && <RunLogViewer onClose={() => setShowLog(false)} />}
    </div>
  );
}
