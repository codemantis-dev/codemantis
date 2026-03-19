import { useTaskBoardStore } from "../../stores/taskBoardStore";

interface Props {
  projectPath: string;
}

export default function TaskBoardBadge({ projectPath }: Props) {
  const plan = useTaskBoardStore((s) => s.plans.get(projectPath));
  const executingWp = useTaskBoardStore((s) => s.executingWorkPackage);

  if (!plan) return null;

  const currentWp = plan.work_packages.find(
    (wp) => wp.status === "in_progress" || wp.status === "verifying"
  );
  const doneTasks = plan.work_packages.reduce(
    (sum, wp) => sum + wp.tasks.filter((t) => t.status === "done").length,
    0
  );
  const totalTasks = plan.work_packages.reduce((sum, wp) => sum + wp.tasks.length, 0);

  if (totalTasks === 0) return null;

  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
        executingWp ? "animate-pulse" : ""
      }`}
      style={{
        background: "var(--accent-bg)",
        color: "var(--accent)",
      }}
    >
      {currentWp ? `${currentWp.name}: ` : ""}
      {doneTasks}/{totalTasks}
    </span>
  );
}
