import type { PlanningMessage } from "../../types/task-board";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { Info } from "lucide-react";
import ProgressUpdateMessage from "./ProgressUpdateMessage";

interface Props {
  message: PlanningMessage;
  projectPath?: string;
}

/** Try to extract wp name and pass/total counts from a progress message. */
function parseProgressContent(content: string): { wpName: string; passCount: number; totalCount: number } | null {
  const match = content.match(/Work Package "(.+?)" completed\.\s*(\d+)\/(\d+) checks passed/);
  if (!match) return null;
  return { wpName: match[1], passCount: parseInt(match[2], 10), totalCount: parseInt(match[3], 10) };
}

export default function PlanningChatMessage({ message, projectPath }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isProgress = message.message_type === "progress_update";

  if (isProgress && projectPath) {
    const parsed = parseProgressContent(message.content);
    if (parsed) {
      // Look up the work package by name to get check results
      const plan = useTaskBoardStore.getState().plans.get(projectPath);
      const wp = plan?.work_packages.find((w) => w.name === parsed.wpName);
      const checks = wp
        ? wp.tasks.flatMap((t) =>
            t.verification_checks.map((c) => ({
              description: c.description,
              passed: c.result?.passed ?? false,
              evidence: c.result?.evidence ?? "",
            }))
          )
        : [];
      const filesChanged = wp
        ? wp.tasks.filter((t) => t.status === "done").map((t) => t.title)
        : [];

      return (
        <ProgressUpdateMessage
          wpName={parsed.wpName}
          passCount={parsed.passCount}
          totalCount={parsed.totalCount}
          checks={checks}
          filesChanged={filesChanged}
          hasConsoleErrors={false}
        />
      );
    }
  }

  if (isProgress || isSystem) {
    return (
      <div
        className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
        style={{
          background: isProgress ? "var(--accent-bg)" : "var(--bg-elevated)",
          color: "var(--text-secondary)",
        }}
      >
        <Info size={14} className="shrink-0 mt-0.5" />
        <div className="whitespace-pre-wrap break-words min-w-0">{message.content}</div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-lg px-3 py-2 text-sm"
        style={{
          background: isUser ? "var(--accent)" : "var(--bg-elevated)",
          color: isUser ? "white" : "var(--text-primary)",
        }}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>

        {/* Attachment chips */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                style={{ background: "rgba(255,255,255,0.15)" }}
              >
                {att.type === "image" && att.preview_url && (
                  <img src={att.preview_url} alt="" className="w-9 h-9 rounded object-cover" />
                )}
                {att.type === "document" && <span>{att.name}</span>}
              </div>
            ))}
          </div>
        )}

        <div
          className="text-[10px] mt-1 opacity-60"
          style={{ color: isUser ? "rgba(255,255,255,0.7)" : "var(--text-ghost)" }}
        >
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}
