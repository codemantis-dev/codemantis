import { useEffect, useState } from "react";
import { useTriviaRotation } from "../../hooks/useTriviaRotation";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { SessionActivityInfo } from "../../stores/sessionStore";
import type { SubAgentInfo } from "../../types/activity";
import TriviaCard from "./TriviaCard";

const TRIVIA_DELAY_MS = 3000;
const COLLAPSE_THRESHOLD = 3;

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

function formatAgentElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

interface ThinkingIndicatorProps {
  sessionId: string;
}

function SubAgentRow({ agent }: { agent: SubAgentInfo }) {
  const typeLabel = agent.subagentType !== "general-purpose" ? agent.subagentType : null;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
      <span className="text-label text-text-secondary truncate">{agent.description}</span>
      {typeLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-ghost shrink-0">
          {typeLabel}
        </span>
      )}
      {agent.toolCount != null && agent.toolCount > 0 && (
        <span className="text-[10px] text-text-ghost shrink-0">· {agent.toolCount} tool uses</span>
      )}
      {agent.tokenCount != null && agent.tokenCount > 0 && (
        <span className="text-[10px] text-text-ghost shrink-0">
          · {agent.tokenCount >= 1000 ? `${(agent.tokenCount / 1000).toFixed(1)}K` : agent.tokenCount} tokens
        </span>
      )}
      {agent.elapsed > 0 && (
        <span className="text-[10px] text-text-ghost font-mono shrink-0 ml-auto">
          {formatAgentElapsed(agent.elapsed)}
        </span>
      )}
    </div>
  );
}

function SubAgentPanel({ agents }: { agents: SubAgentInfo[] }) {
  const fewAgents = agents.length <= COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(fewAgents);

  // Auto-expand when few agents, collapse when many
  useEffect(() => {
    setExpanded(fewAgents);
  }, [fewAgents]);

  if (agents.length === 0) return null;

  // Check if any agent has live progress data
  const hasActivity = agents.some((a) => a.currentActivity);

  return (
    <div
      className="rounded-xl px-3 py-2 mt-1 transition-all duration-200"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-light)" }}
    >
      {/* Summary header */}
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-text-ghost select-none">{expanded ? "▼" : "▶"}</span>
        <span className="text-label text-text-dim font-medium">
          {agents.length === 1
            ? `1 sub-agent running`
            : `${agents.length} sub-agents running`}
        </span>
      </button>

      {/* Expanded detail rows */}
      {expanded && (
        <div className="mt-1.5 space-y-0.5">
          {agents.map((agent) => (
            <SubAgentRow key={agent.toolUseId} agent={agent} />
          ))}
        </div>
      )}

      {/* Live activity line from Phase 2 data */}
      {hasActivity && (
        <div className="mt-1 text-[10px] text-text-ghost truncate">
          {agents.find((a) => a.currentActivity)?.currentActivity}
        </div>
      )}
    </div>
  );
}

export default function ThinkingIndicator({ sessionId }: ThinkingIndicatorProps) {
  const triviaEnabled = useSettingsStore((s) => s.settings.triviaEnabled);
  const activity = useSessionStore((s) => s.sessionActivity.get(sessionId));
  const isCompacting = useSessionStore((s) => s.sessionCompacting.get(sessionId) ?? false);
  const busySince = useSessionStore((s) => s.busySince.get(sessionId));
  const subAgents = useSessionStore((s) => s.activeSubAgents.get(sessionId)) ?? [];

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

  // Show tool elapsed if available and > 5s (but not for Agent — shown in panel)
  const toolElapsedStr = activityInfo.toolElapsed > 5 && activityInfo.toolName !== "Agent"
    ? ` (${Math.round(activityInfo.toolElapsed)}s)`
    : "";

  const runningAgents = subAgents.filter((a) => a.status === "running");

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

      {/* Sub-agent detail panel */}
      {runningAgents.length > 0 && (
        <SubAgentPanel agents={runningAgents} />
      )}

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
