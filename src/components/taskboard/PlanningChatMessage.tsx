import { useState, useCallback } from "react";
import type { PlanningMessage } from "../../types/task-board";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { Info, Copy, Check } from "lucide-react";
import ProgressUpdateMessage from "./ProgressUpdateMessage";

interface Props {
  message: PlanningMessage;
  projectPath?: string;
  isLastAssistant?: boolean;
  onSelectOption?: (option: string) => void;
}

/** Try to extract wp name and pass/total counts from a progress message. */
function parseProgressContent(content: string): { wpName: string; passCount: number; totalCount: number } | null {
  const match = content.match(/Work Package "(.+?)" completed\.\s*(\d+)\/(\d+) checks passed/);
  if (!match) return null;
  return { wpName: match[1], passCount: parseInt(match[2], 10), totalCount: parseInt(match[3], 10) };
}

export default function PlanningChatMessage({ message, projectPath, isLastAssistant, onSelectOption }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const isProgress = message.message_type === "progress_update";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} group`}>
      <div
        className="relative max-w-[85%] rounded-lg px-3 py-2 text-sm"
        style={{
          background: isUser ? "var(--accent)" : "var(--bg-elevated)",
          color: isUser ? "white" : "var(--text-primary)",
        }}
      >
        {isAssistant && (
          <button
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy message"}
            className="absolute top-1.5 right-1.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-ghost)", background: "var(--bg-primary)" }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
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

        {/* Selectable options */}
        {isLastAssistant && message.parsedOptions && message.parsedOptions.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {message.parsedOptions.map((opt, i) => (
              <button
                key={i}
                onClick={() => onSelectOption?.(opt)}
                className="text-left px-3 py-2 rounded-md border text-xs transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-primary)' }}
              >
                {opt}
              </button>
            ))}
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>
              or type your own answer below
            </div>
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
