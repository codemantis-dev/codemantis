import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { interruptSession } from "../../lib/tauri-commands";

interface StuckActivityBannerProps {
  sessionId: string;
}

/**
 * Renders a one-line warning above SessionStatusBar when the watchdog
 * (useStuckActivityWatchdog) has flagged this session as stuck. UI-only:
 * the buttons act on the user's explicit choice — Reopen approval, Stop
 * session. No auto-recovery.
 */
export default function StuckActivityBanner({ sessionId }: StuckActivityBannerProps) {
  const stuck = useSessionStore((s) => s.sessionStuck.get(sessionId));
  const setShowApprovalModal = useUiStore((s) => s.setShowApprovalModal);
  const [stoppingState, setStoppingState] = useState<"idle" | "stopping">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!stuck) {
      setElapsedSec(0);
      return;
    }
    const tick = () => setElapsedSec(Math.floor((Date.now() - stuck.since) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stuck]);

  if (!stuck) return null;

  const isPendingApproval = stuck.reason === "pending-approval-not-shown";
  const message = isPendingApproval
    ? `Codex is waiting for your approval but the prompt isn't showing.`
    : `Codex hasn't responded for ${elapsedSec}s.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1.5 border-t border-border bg-yellow/10 text-label"
    >
      <AlertTriangle size={14} className="text-yellow shrink-0" />
      <span className="text-yellow font-medium shrink-0">{message}</span>
      <div className="flex-1" />
      {isPendingApproval && (
        <button
          type="button"
          onClick={() => setShowApprovalModal(true)}
          className="px-2 py-0.5 rounded border border-yellow/40 text-yellow hover:bg-yellow/20"
        >
          Reopen approval
        </button>
      )}
      <button
        type="button"
        disabled={stoppingState === "stopping"}
        onClick={async () => {
          setStoppingState("stopping");
          try {
            await interruptSession(sessionId);
          } catch (e) {
            // Surface but don't crash the banner — the user can retry.
            console.error("Stop session failed:", e);
          } finally {
            setStoppingState("idle");
          }
        }}
        className="px-2 py-0.5 rounded border border-red/40 text-red hover:bg-red/20 disabled:opacity-50"
      >
        {stoppingState === "stopping" ? "Stopping..." : "Stop session"}
      </button>
    </div>
  );
}
