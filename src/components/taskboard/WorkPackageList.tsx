import { useRef, useState } from "react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import WorkPackageCard from "./WorkPackageCard";

interface Props {
  projectPath: string;
}

export default function WorkPackageList({ projectPath }: Props) {
  const plan = useTaskBoardStore((s) => s.plans.get(projectPath));
  const expandedWp = useTaskBoardStore(
    (s) => s.uiState.get(projectPath)?.expanded_work_package ?? null
  );
  const setExpandedWorkPackage = useTaskBoardStore((s) => s.setExpandedWorkPackage);
  const reorderWorkPackages = useTaskBoardStore((s) => s.reorderWorkPackages);

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

      {/* Work packages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
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
