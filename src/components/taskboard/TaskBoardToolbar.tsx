import { Play, Pause, RefreshCw } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { useTaskExecution } from "../../hooks/useTaskExecution";
import { usePlanningConversation } from "../../hooks/usePlanningConversation";

interface Props {
  projectPath: string;
}

export default function TaskBoardToolbar({ projectPath }: Props) {
  const plan = useTaskBoardStore((s) => s.plans.get(projectPath));
  const isPaused = useTaskBoardStore((s) => s.isPaused);
  const executingWp = useTaskBoardStore((s) => s.executingWorkPackage);
  const { executeAllWorkPackages, pauseExecution, resumeExecution } = useTaskExecution();
  const { sendPlanningMessage } = usePlanningConversation();

  if (!plan) return null;

  const isExecuting = executingWp !== null;
  const allDone = plan.work_packages.every(
    (wp) => wp.status === "done" || wp.status === "needs_review"
  );

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-t shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {/* Start All */}
      {!isExecuting && !allDone && (
        <button
          onClick={() => executeAllWorkPackages(projectPath)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          <Play size={12} />
          Start All
        </button>
      )}

      {/* Pause */}
      {isExecuting && !isPaused && (
        <button
          onClick={pauseExecution}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
        >
          <Pause size={12} />
          Pause
        </button>
      )}

      {/* Resume */}
      {isPaused && (
        <button
          onClick={() => resumeExecution(projectPath)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          <Play size={12} />
          Resume
        </button>
      )}

      {/* Re-plan */}
      <button
        onClick={() =>
          sendPlanningMessage(
            projectPath,
            "Please regenerate the task plan based on our conversation so far and the current progress."
          )
        }
        disabled={isExecuting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-30"
        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
      >
        <RefreshCw size={12} />
        Re-plan
      </button>

      {/* Status */}
      <div className="flex-1" />
      {allDone && (
        <span className="text-xs" style={{ color: "#22c55e" }}>
          All packages complete
        </span>
      )}
      {isExecuting && (
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          Executing...
        </span>
      )}
    </div>
  );
}
