import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SpecMessage } from "../../types/spec-writer";
import { Copy, Check, Send, Info, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  message: SpecMessage;
  isLastAssistant?: boolean;
  onSelectOption?: (option: string) => void;
}

export default function SpecChatMessage({ message, isLastAssistant, onSelectOption }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
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

  // File context messages — collapsible, abbreviated view
  if (isSystem && message.message_type === 'file_context') {
    return <FileContextMessage content={message.content} timestamp={message.timestamp} />;
  }

  if (isSystem) {
    return (
      <div
        className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
        style={{
          background: "var(--bg-elevated)",
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

        {/* Selectable options */}
        {isLastAssistant && message.parsedOptions && message.parsedOptions.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-2">
            {message.parsedOptions.map((opt, i) => {
              const isSelected = selectedOptions.has(i);
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (selectedOptions.size === 0) {
                      onSelectOption?.(opt);
                    } else {
                      toggleOption(i);
                    }
                  }}
                  onContextMenu={(e) => {
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

// ── File Context Message (collapsible) ──────────────────────────

interface FileEntry {
  path: string;
  found: boolean;
  lineInfo: string;
  content: string;
}

function parseFileContextContent(raw: string): FileEntry[] {
  const entries: FileEntry[] = [];
  // Match === path (info) === blocks
  const pattern = /^===\s+(.+?)\s+(?:\(NOT FOUND\)|(?:\((?:showing first \d+ of )?(\d+) lines?\)))\s+===$/gm;
  let match;
  const positions: { path: string; found: boolean; lineInfo: string; start: number }[] = [];

  while ((match = pattern.exec(raw)) !== null) {
    const path = match[1];
    const found = !raw.substring(match.index, match.index + match[0].length).includes("NOT FOUND");
    const lineInfo = found ? (match[2] ? `${match[2]} lines` : '') : 'not found';
    positions.push({ path, found, lineInfo, start: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const endPos = i + 1 < positions.length
      ? raw.lastIndexOf('\n===', positions[i + 1].start - positions[i + 1].path.length - 20)
      : raw.length;
    const content = raw.substring(positions[i].start, endPos).trim();
    entries.push({ ...positions[i], content });
  }

  return entries;
}

function FileContextMessage({ content, timestamp }: { content: string; timestamp: string }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());
  const entries = parseFileContextContent(content);

  const toggleFile = useCallback((idx: number) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  return (
    <div
      className="rounded-md text-xs border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:brightness-95 transition-colors"
        style={{ color: "var(--text-secondary)" }}
      >
        <FolderOpen size={13} className="shrink-0" style={{ color: "var(--accent)" }} />
        <span className="font-medium">
          📂 {entries.length} file{entries.length !== 1 ? 's' : ''} loaded
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] opacity-60">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {entries.map((entry, idx) => (
            <div key={idx} className="rounded" style={{ background: "var(--bg-primary)" }}>
              <button
                onClick={() => entry.found ? toggleFile(idx) : undefined}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                style={{
                  color: entry.found ? "var(--text-primary)" : "var(--text-ghost)",
                  cursor: entry.found ? "pointer" : "default",
                }}
              >
                <span className="font-mono truncate flex-1">{entry.path}</span>
                <span className="text-[10px] shrink-0 opacity-60">
                  {entry.found ? entry.lineInfo : '⚠ not found'}
                </span>
                {entry.found && (
                  expandedFiles.has(idx)
                    ? <ChevronDown size={11} className="shrink-0" />
                    : <ChevronRight size={11} className="shrink-0" />
                )}
              </button>
              {entry.found && expandedFiles.has(idx) && (
                <pre
                  className="px-2 pb-2 overflow-x-auto text-[11px] leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {entry.content}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
