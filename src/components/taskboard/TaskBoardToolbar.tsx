import { useState } from "react";
import { Play, Pause, Square, RefreshCw, Trash2 } from "lucide-react";
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
  const pendingAction = useTaskBoardStore((s) => s.pendingUserAction.get(projectPath));
  const decision = useTaskBoardStore((s) => s.projectTargetDecisions.get(projectPath));
  const discardAndStartNew = useTaskBoardStore((s) => s.discardAndStartNew);
  const { executeAllWorkPackages, pauseExecution, resumeExecution, cancelExecution } = useTaskExecution();
  const { sendPlanningMessage } = usePlanningConversation();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  if (!plan) return null;

  const isExecuting = executingWp !== null;
  const isTargetDecided = decision?.type === 'current_project' || decision?.type === 'new_project';
  const allDone = plan.work_packages.every(
    (wp) => wp.status === "done" || wp.status === "needs_review"
  );

  // Inline confirmation mode
  if (confirmingDiscard) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-2 border-t shrink-0"
        style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Discard this plan?
        </span>
        <button
          onClick={() => setConfirmingDiscard(false)}
          className="px-3 py-1.5 rounded text-xs transition-colors"
          style={{ color: "var(--text-dim)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            discardAndStartNew(projectPath);
            setConfirmingDiscard(false);
          }}
          className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
          style={{ background: "#ef4444", color: "white" }}
        >
          Discard
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-t shrink-0"
      style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
    >
      {/* Start All */}
      {!isExecuting && !allDone && (
        <button
          onClick={() => executeAllWorkPackages(projectPath)}
          disabled={!isTargetDecided}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ background: "var(--accent)", color: "white" }}
          title={!isTargetDecided ? "Choose a project target first" : "Start all work packages"}
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
          title="Pause after current work package"
        >
          <Pause size={12} />
          Pause
        </button>
      )}

      {/* Cancel */}
      {isExecuting && (
        <button
          onClick={() => cancelExecution(projectPath)}
          title="Cancel execution"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{ background: '#ef4444', color: 'white' }}
        >
          <Square size={12} />
          Cancel
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
        title="Regenerate the plan"
      >
        <RefreshCw size={12} />
        Re-plan
      </button>

      {/* Discard Plan */}
      <button
        onClick={() => setConfirmingDiscard(true)}
        disabled={isExecuting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-30"
        style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}
        title="Discard plan and start fresh"
      >
        <Trash2 size={12} />
        Discard Plan
      </button>

      {/* Status */}
      <div className="flex-1" />
      {allDone && (
        <span className="text-xs" style={{ color: "#22c55e" }}>
          All packages complete
        </span>
      )}
      {isExecuting && pendingAction && (
        <span className="text-xs" style={{ color: "#3b82f6" }}>
          Waiting for user action...
        </span>
      )}
      {isExecuting && !pendingAction && (
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          Executing...
        </span>
      )}
    </div>
  );
}
