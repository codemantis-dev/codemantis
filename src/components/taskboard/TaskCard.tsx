import { useState } from "react";
import { Check, XCircle, Loader2, Clock, SkipForward, ChevronDown, ChevronRight, Hand } from "lucide-react";
import VerificationResults from "./VerificationResults";
import type { TaskItem } from "../../types/task-board";

const TASK_STATUS_ICONS: Record<string, React.ReactNode> = {
  planned: <Clock size={12} style={{ color: "var(--text-ghost)" }} />,
  in_progress: <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent)" }} />,
  done: <Check size={12} style={{ color: "#22c55e" }} />,
  failed: <XCircle size={12} style={{ color: "#ef4444" }} />,
  skipped: <SkipForward size={12} style={{ color: "var(--text-ghost)" }} />,
};

interface Props {
  task: TaskItem;
  projectPath: string;
}

export default function TaskCard({ task }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasChecks = task.verification_checks.some((c) => c.result);

  return (
    <div
      className="rounded px-2 py-1.5 text-xs"
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {TASK_STATUS_ICONS[task.status] ?? TASK_STATUS_ICONS.planned}
        <span
          className="flex-1 truncate"
          style={{
            color: task.status === "done" ? "var(--text-dim)" : "var(--text-primary)",
            textDecoration: task.status === "done" ? "line-through" : "none",
          }}
        >
          {task.title}
        </span>
        {task.requires_user_action && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
            style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
            title={task.requires_user_action}
          >
            <Hand size={9} />
            Manual
          </span>
        )}
        {hasChecks && (
          expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
        )}
      </div>

      {expanded && (
        <div className="mt-1.5 ml-4 space-y-1">
          <div style={{ color: "var(--text-dim)" }}>{task.description}</div>
          {task.acceptance_criteria && (
            <div style={{ color: "var(--text-ghost)" }}>
              <span className="font-medium">Acceptance:</span> {task.acceptance_criteria}
            </div>
          )}
          {task.verification_checks.length > 0 && (
            <VerificationResults checks={task.verification_checks} />
          )}
        </div>
      )}
    </div>
  );
}
