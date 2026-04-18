// ═══════════════════════════════════════════════════════════════════════
// Run Log Viewer — scrollable timestamped log of Self-Drive events
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { useSelfDriveStore } from "../../stores/selfDriveStore";
import { formatDuration } from "../../lib/format-utils";
import type { RunLogEntry } from "../../types/implementation-guide";
import CopyButton from "../shared/CopyButton";

interface Props {
  onClose: () => void;
}

const PHASE_ICONS: Record<string, string> = {
  started: "\u25b6",     // ▶
  building: "\ud83d\udce4",   // 📤
  "build-checking": "\ud83d\udd0d", // 🔍
  verifying: "\ud83d\udce4",  // 📤
  fixing: "\ud83d\udd27",     // 🔧
  testing: "\ud83e\uddea",    // 🧪
  evaluating: "\ud83d\udd0d", // 🔍
  advancing: "\u27a1\ufe0f",  // ➡️
  committing: "\ud83d\udcbe", // 💾
  recovering: "\ud83d\udee0",  // 🛠
  decision: "\ud83e\udde0",   // 🧠
  paused: "\u26a0\ufe0f",     // ⚠️
  resumed: "\u25b6",    // ▶
  stopped: "\u23f9",     // ⏹
  completed: "\ud83c\udf89",  // 🎉
  aborted: "\u274c",     // ❌
  crash: "\ud83d\udca5",      // 💥
  "blocker-detected": "\ud83d\udeab",       // 🚫
  "blocker-user-decided": "\u270f\ufe0f",    // ✏️
  "blocker-verifying": "\ud83d\udd0e",       // 🔎
  "blocker-resolved": "\u2705",              // ✅
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function RunLogViewer({ onClose }: Props) {
  const runLog = useSelfDriveStore((s) => s.runLog);
  const startedAt = useSelfDriveStore((s) => s.startedAt);
  const status = useSelfDriveStore((s) => s.status);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [runLog.length]);

  // Compute summary
  const totalTime = startedAt ? Date.now() - startedAt : 0;
  const sessionCount = new Set(runLog.map((e) => e.sessionIndex).filter((i) => i > 0)).size;
  const fixCount = runLog.filter((e) => e.phase === "fixing").length;
  const pauseCount = runLog.filter((e) => e.phase === "paused").length;
  const orchestratorCalls = runLog.filter((e) => e.phase === "decision").length;

  // Flatten the run log to plain text for the header Copy button. Each
  // entry becomes one line; expanded prompts are appended indented below.
  const buildLogText = (): string => {
    return runLog
      .map((e) => {
        const head = `${formatTimestamp(e.timestamp)}  ${e.summary}`;
        if (e.prompt) {
          const indented = e.prompt.split("\n").map((l) => `    ${l}`).join("\n");
          return `${head}\n${indented}`;
        }
        return head;
      })
      .join("\n");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[520px] max-h-[70vh] rounded-xl border shadow-2xl flex flex-col"
        style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border-light)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            Self-Drive Run Log
          </span>
          <div className="flex items-center gap-1">
            {runLog.length > 0 && (
              <CopyButton getText={buildLogText} label="Copy full log" size={14} />
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-elevated transition-colors"
              title="Close"
            >
              <X size={14} style={{ color: "var(--text-ghost)" }} />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5 font-mono text-label select-text">
          {runLog.length === 0 ? (
            <p className="text-center py-4" style={{ color: "var(--text-ghost)" }}>
              No log entries yet
            </p>
          ) : (
            runLog.map((entry) => (
              <LogLine key={`${entry.sessionIndex}-${entry.timestamp}`} entry={entry} />
            ))
          )}
        </div>

        {/* Summary footer */}
        {runLog.length > 0 && (
          <div className="px-4 py-2.5 border-t" style={{ borderColor: "var(--border-light)" }}>
            <div className="flex items-center gap-3 text-detail" style={{ color: "var(--text-secondary)" }}>
              <span>Sessions: {sessionCount}</span>
              <span className="opacity-40">|</span>
              <span>Fixes: {fixCount}</span>
              <span className="opacity-40">|</span>
              <span>Pauses: {pauseCount}</span>
              <span className="opacity-40">|</span>
              <span>Time: {formatDuration(totalTime, "human")}</span>
              <span className="opacity-40">|</span>
              <span>Orchestrator: {orchestratorCalls} calls</span>
            </div>
            {status === "completed" && (
              <div
                className="mt-1 text-detail font-medium"
                style={{ color: "var(--color-green, #22c55e)" }}
              >
                Run completed successfully
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: RunLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const icon = PHASE_ICONS[entry.phase] ?? "\u2022"; // bullet fallback
  const isError = entry.phase === "paused" || entry.phase === "aborted" || entry.phase === "crash" || entry.phase === "blocker-detected";
  const isSuccess = entry.phase === "completed" || entry.phase === "advancing" || entry.phase === "blocker-resolved";

  return (
    <div>
      <div className="flex gap-2 leading-relaxed py-0.5">
        <span style={{ color: "var(--text-ghost)" }} className="shrink-0 w-[60px]">
          {formatTimestamp(entry.timestamp)}
        </span>
        <span className="shrink-0 w-[18px] text-center">{icon}</span>
        <span
          className="flex-1 break-words"
          style={{
            color: isError
              ? "var(--yellow, #eab308)"
              : isSuccess
                ? "var(--color-green, #22c55e)"
                : "var(--text-secondary)",
          }}
        >
          {entry.summary}
        </span>
        {entry.prompt && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-detail transition-colors hover:bg-bg-elevated"
            style={{ color: "var(--text-ghost)" }}
            title={expanded ? "Hide prompt" : "Show prompt"}
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Prompt
          </button>
        )}
      </div>
      {expanded && entry.prompt && (
        <pre
          className="ml-[80px] mr-2 mt-0.5 mb-1 p-2 rounded text-detail overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-light)",
          }}
        >
          {entry.prompt}
        </pre>
      )}
    </div>
  );
}
