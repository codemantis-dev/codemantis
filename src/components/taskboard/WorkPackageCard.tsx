import { Play, ChevronDown, ChevronRight, Check, Loader2, Clock, AlertTriangle } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { useTaskExecution } from "../../hooks/useTaskExecution";
import TaskCard from "./TaskCard";
import type { WorkPackage } from "../../types/task-board";

const STATUS_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  planned: { icon: <Clock size={14} />, color: "var(--text-ghost)" },
  in_progress: { icon: <Loader2 size={14} className="animate-spin" />, color: "var(--accent)" },
  verifying: { icon: <Loader2 size={14} className="animate-spin" />, color: "#f59e0b" },
  done: { icon: <Check size={14} />, color: "#22c55e" },
  needs_review: { icon: <AlertTriangle size={14} />, color: "#ef4444" },
};

interface Props {
  wp: WorkPackage;
  projectPath: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function WorkPackageCard({ wp, projectPath, isExpanded, onToggle }: Props) {
  const { executeWorkPackage } = useTaskExecution();
  const executingWp = useTaskBoardStore((s) => s.executingWorkPackage);
  const decision = useTaskBoardStore((s) => s.projectTargetDecisions.get(projectPath));
  const isTargetDecided = decision?.type === 'current_project' || decision?.type === 'new_project';
  const doneTasks = wp.tasks.filter((t) => t.status === "done").length;
  const statusInfo = STATUS_ICONS[wp.status] ?? STATUS_ICONS.planned;

  return (
    <div
      className="rounded-md border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-elevated transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: "var(--text-ghost)" }} />
        ) : (
          <ChevronRight size={14} style={{ color: "var(--text-ghost)" }} />
        )}

        <span style={{ color: statusInfo.color }}>{statusInfo.icon}</span>

        <span className="text-sm font-medium flex-1" style={{ color: "var(--text-primary)" }}>
          {wp.name}
        </span>

        <span className="text-xs tabular-nums" style={{ color: "var(--text-dim)" }}>
          {doneTasks}/{wp.tasks.length}
        </span>

        {/* Progress bar */}
        <div
          className="w-16 h-1 rounded-full overflow-hidden"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${wp.tasks.length > 0 ? (doneTasks / wp.tasks.length) * 100 : 0}%`,
              background: wp.status === "done" ? "#22c55e" : "var(--accent)",
            }}
          />
        </div>

        {/* Start button */}
        {(wp.status === "planned" || wp.status === "needs_review") && !executingWp && isTargetDecided && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              executeWorkPackage(projectPath, wp.id);
            }}
            title="Start this work package"
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--accent)" }}
          >
            <Play size={12} />
          </button>
        )}
      </div>

      {/* Retry indicator */}
      {wp.retry_count > 0 && wp.status !== "done" && (
        <div
          className="px-3 py-1 text-xs"
          style={{ color: "#f59e0b", background: "rgba(245,158,11,0.1)" }}
        >
          Auto-retrying... attempt {wp.retry_count}/{3}
        </div>
      )}

      {/* Expanded tasks */}
      {isExpanded && (
        <div className="border-t px-2 py-1 space-y-1" style={{ borderColor: "var(--border)" }}>
          {wp.tasks.map((task) => (
            <TaskCard key={task.id} task={task} projectPath={projectPath} />
          ))}
        </div>
      )}
    </div>
  );
}
