import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PlanningMessage } from "../../types/task-board";
import { useTaskBoardStore } from "../../stores/taskBoardStore";
import { Info, Copy, Check, Send, AlertCircle } from "lucide-react";
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
  const [selectedOptions, setSelectedOptions] = useState<Set<number>>(new Set());

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

  const toggleOption = useCallback((index: number) => {
    setSelectedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const sendSelected = useCallback(() => {
    if (!message.parsedOptions || selectedOptions.size === 0) return;
    const chosen = [...selectedOptions]
      .sort()
      .map((i) => message.parsedOptions![i])
      .join(", ");
    onSelectOption?.(chosen);
    setSelectedOptions(new Set());
  }, [message.parsedOptions, selectedOptions, onSelectOption]);

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

  if (message.message_type === "user_action_required") {
    return (
      <div
        className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
        style={{
          background: "rgba(59,130,246,0.1)",
          color: "#3b82f6",
        }}
      >
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <div className="whitespace-pre-wrap break-words min-w-0">{message.content}</div>
      </div>
    );
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
        {isAssistant ? (
          <div className="markdown-content text-sm" style={{ color: "var(--text-primary)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        )}

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

        {/* Selectable options — click to toggle, send button for multi-select */}
        {isLastAssistant && message.parsedOptions && message.parsedOptions.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {message.parsedOptions.map((opt, i) => {
              const isSelected = selectedOptions.has(i);
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (selectedOptions.size === 0) {
                      // First click — send immediately (single select)
                      onSelectOption?.(opt);
                    } else {
                      toggleOption(i);
                    }
                  }}
                  onContextMenu={(e) => {
                    // Right-click or long-press to toggle multi-select
                    e.preventDefault();
                    toggleOption(i);
                  }}
                  className="text-left px-3 py-2 rounded-md border text-xs transition-colors"
                  style={{
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                    color: 'var(--text-primary)',
                    background: isSelected ? 'var(--accent-bg)' : 'var(--bg-primary)',
                  }}
                >
                  {opt}
                </button>
              );
            })}
            {selectedOptions.size > 0 && (
              <button
                onClick={sendSelected}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors hover:opacity-90"
                style={{ background: "var(--accent)", color: "white" }}
              >
                <Send size={11} />
                Send {selectedOptions.size} selected
              </button>
            )}
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-ghost)' }}>
              {selectedOptions.size > 0
                ? "Click more options to add, or press Send"
                : "Click to answer \u00b7 Right-click to multi-select"}
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
