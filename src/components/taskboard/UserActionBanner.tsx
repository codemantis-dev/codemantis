import { AlertCircle } from "lucide-react";
import { useTaskBoardStore } from "../../stores/taskBoardStore";

interface Props {
  projectPath: string;
}

export default function UserActionBanner({ projectPath }: Props) {
  const pending = useTaskBoardStore((s) => s.pendingUserAction.get(projectPath));
  const setPendingUserAction = useTaskBoardStore((s) => s.setPendingUserAction);

  if (!pending) return null;

  return (
    <div
      className="px-3 py-2 border-b flex items-start gap-2 shrink-0"
      style={{ borderColor: "var(--border)", background: "rgba(59,130,246,0.1)" }}
    >
      <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium mb-1" style={{ color: "#3b82f6" }}>
          Manual action required
        </div>
        <div
          className="text-xs whitespace-pre-wrap"
          style={{ color: "var(--text-secondary)" }}
        >
          {pending.message}
        </div>
        <button
          onClick={() => setPendingUserAction(projectPath, null)}
          className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "#3b82f6", color: "white" }}
        >
          I've completed this — continue execution
        </button>
      </div>
    </div>
  );
}
