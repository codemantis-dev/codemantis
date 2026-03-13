import { useEffect, useState } from "react";
import { useTriviaRotation } from "../../hooks/useTriviaRotation";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionActivityInfo } from "../../stores/sessionStore";
import TriviaCard from "./TriviaCard";

const TRIVIA_DELAY_MS = 3000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin.toString().padStart(2, "0")}m`;
}

interface ThinkingIndicatorProps {
  sessionId: string;
}

export default function ThinkingIndicator({ sessionId }: ThinkingIndicatorProps) {
  const triviaEnabled = useSettingsStore((s) => s.settings.triviaEnabled);
  const activity = useSessionStore((s) => s.sessionActivity.get(sessionId));
  const isCompacting = useSessionStore((s) => s.sessionCompacting.get(sessionId) ?? false);
  const busySince = useSessionStore((s) => s.busySince.get(sessionId));

  const [showTrivia, setShowTrivia] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const triviaActive = triviaEnabled && showTrivia;
  const trivia = useTriviaRotation(triviaActive);

  // Elapsed timer: ticks every second while busy
  useEffect(() => {
    if (!busySince) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - busySince);
    const timer = setInterval(() => {
      setElapsed(Date.now() - busySince);
    }, 1000);
    return () => clearInterval(timer);
  }, [busySince]);

  // Delay trivia display by 3 seconds after mount
  useEffect(() => {
    setShowTrivia(false);
    const timer = setTimeout(() => {
      setShowTrivia(true);
    }, TRIVIA_DELAY_MS);
    return () => clearTimeout(timer);
  }, [triviaEnabled]);

  const activityInfo: SessionActivityInfo = activity ?? { label: "Thinking...", toolName: null, toolElapsed: 0, filePath: null };
  const displayLabel = isCompacting ? "Compacting context..." : activityInfo.label;

  // Show tool elapsed if available and > 5s
  const toolElapsedStr = activityInfo.toolElapsed > 5
    ? ` (${Math.round(activityInfo.toolElapsed)}s)`
    : "";

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl rounded-bl-md"
        style={{ background: "var(--bg-elevated)" }}
      >
        {/* Animated orbs */}
        <div className="flex items-center gap-1">
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "0ms" }} />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "150ms" }} />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style={{ animationDelay: "300ms" }} />
        </div>

        <span className="text-chat text-text-dim">
          {displayLabel}{toolElapsedStr}
        </span>

        {/* Elapsed timer */}
        {elapsed > 0 && (
          <span className="text-label text-text-ghost font-mono ml-1">
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      {triviaActive && (
        <TriviaCard
          topic={trivia.topic}
          fact={trivia.fact}
          isEasterEgg={trivia.isEasterEgg}
          factKey={trivia.factKey}
        />
      )}
    </div>
  );
}
