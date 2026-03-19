import { useRef, useState, useEffect, useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { useTaskExecution } from "../../hooks/useTaskExecution";
import WorkPackageCard from "./WorkPackageCard";
import ProjectTargetDecisionComponent from "./ProjectTargetDecision";

interface Props {
  projectPath: string;
  onSwitchProject: (path: string) => Promise<void>;
}

export default function WorkPackageList({ projectPath, onSwitchProject }: Props) {
  const plan = useTaskBoardStore((s) => s.plans.get(projectPath));
  const decision = useTaskBoardStore((s) => s.projectTargetDecisions.get(projectPath));
  const expandedWp = useTaskBoardStore(
    (s) => s.uiState.get(projectPath)?.expanded_work_package ?? null
  );
  const setExpandedWorkPackage = useTaskBoardStore((s) => s.setExpandedWorkPackage);
  const reorderWorkPackages = useTaskBoardStore((s) => s.reorderWorkPackages);
  const executingWp = useTaskBoardStore((s) => s.executingWorkPackage);
  const { resumeExecution } = useTaskExecution();

  // Resume banner state
  const [showResumeBanner, setShowResumeBanner] = useState(false);

  useEffect(() => {
    if (plan && plan.status === 'executing' && !executingWp) {
      setShowResumeBanner(true);
    }
  }, [plan?.status, executingWp]);

  const handleResume = useCallback(() => {
    if (!plan) return;
    // Reset any stuck WP back to planned
    const stuckWp = plan.work_packages.find((w) => w.status === 'in_progress');
    if (stuckWp) {
      useTaskBoardStore.getState().updateWorkPackageStatus(projectPath, stuckWp.id, 'planned');
    }
    useTaskBoardStore.getState().updatePlanStatus(projectPath, 'ready');
    setShowResumeBanner(false);
    resumeExecution(projectPath);
  }, [plan, projectPath, resumeExecution]);

  const handleResetBanner = useCallback(() => {
    if (!plan) return;
    const stuckWp = plan.work_packages.find((w) => w.status === 'in_progress');
    if (stuckWp) {
      useTaskBoardStore.getState().updateWorkPackageStatus(projectPath, stuckWp.id, 'planned');
    }
    useTaskBoardStore.getState().updatePlanStatus(projectPath, 'ready');
    setShowResumeBanner(false);
  }, [plan, projectPath]);

  // Drag-and-drop state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdxRef = useRef<number | null>(null);

  if (!plan) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center" style={{ color: "var(--text-dim)" }}>
          <div className="text-sm font-medium mb-1">No plan yet</div>
          <div className="text-xs">
            Start a conversation in the Planning Chat to generate a task plan.
          </div>
        </div>
      </div>
    );
  }

  const totalTasks = plan.work_packages.reduce((sum, wp) => sum + wp.tasks.length, 0);
  const doneTasks = plan.work_packages.reduce(
    (sum, wp) => sum + wp.tasks.filter((t) => t.status === "done").length,
    0
  );

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
    dragIdxRef.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdxRef.current !== null && dragIdxRef.current !== idx) {
      setOverIdx(idx);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const ids = plan.work_packages.map((wp) => wp.id);
      const [moved] = ids.splice(dragIdx, 1);
      ids.splice(overIdx, 0, moved);
      reorderWorkPackages(projectPath, ids);
    }
    setDragIdx(null);
    setOverIdx(null);
    dragIdxRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
    dragIdxRef.current = null;
  };

  const isUndecided = decision?.type === 'undecided';
  const isMigrated = decision?.type === 'migrated';

  // Migrated banner
  if (isMigrated) {
    const migratedTo = decision.type === 'migrated' ? decision.migratedTo : '';
    const targetName = migratedTo.split('/').pop() ?? migratedTo;
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Plan migrated to {targetName}
          </div>
          <button
            onClick={() => onSwitchProject(migratedTo)}
            className="flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <ArrowRight size={12} />
            Switch to project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-3 py-2 text-xs border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="font-medium" style={{ color: "var(--text-primary)" }}>
          {plan.name}
        </div>
        <div className="flex items-center gap-2 mt-1" style={{ color: "var(--text-dim)" }}>
          <span>
            {doneTasks}/{totalTasks} tasks
          </span>
          <div
            className="flex-1 h-1 rounded-full overflow-hidden"
            style={{ background: "var(--bg-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <span className="tabular-nums">
            {totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%
          </span>
        </div>
      </div>

      {/* Decision gate */}
      {isUndecided && (
        <div className="px-3 py-2 shrink-0">
          <ProjectTargetDecisionComponent
            projectPath={projectPath}
            plan={plan}
            onSwitchProject={onSwitchProject}
          />
        </div>
      )}

      {/* Resume banner */}
      {showResumeBanner && (
        <div
          className="px-3 py-2 border-b flex items-center gap-2 shrink-0"
          style={{ borderColor: 'var(--border)', background: 'rgba(245,158,11,0.1)' }}
        >
          <span className="text-xs flex-1" style={{ color: '#f59e0b' }}>
            Execution was interrupted. Resume from where you left off?
          </span>
          <button
            onClick={handleResume}
            className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Resume
          </button>
          <button
            onClick={handleResetBanner}
            className="px-2.5 py-1 rounded-md border text-xs transition-colors hover:bg-bg-elevated"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
          >
            Reset
          </button>
        </div>
      )}

      {/* Work packages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
        style={isUndecided ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        {plan.work_packages.map((wp, idx) => (
          <div
            key={wp.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            style={{
              opacity: dragIdx === idx ? 0.5 : 1,
              borderTop: overIdx === idx && dragIdx !== null && dragIdx > idx
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              borderBottom: overIdx === idx && dragIdx !== null && dragIdx < idx
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              cursor: "grab",
            }}
          >
            <WorkPackageCard
              wp={wp}
              projectPath={projectPath}
              isExpanded={expandedWp === wp.id}
              onToggle={() =>
                setExpandedWorkPackage(
                  projectPath,
                  expandedWp === wp.id ? null : wp.id
                )
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
