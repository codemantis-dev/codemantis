import React, { useState, useCallback } from "react";
import { RotateCcw, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../types/session";
import { formatDuration } from "../../lib/format-utils";
import ActivityChip from "./ActivityChip";
import StreamingCursor from "./StreamingCursor";
import CodeBlock from "./CodeBlock";
import { ExternalLink } from "../../lib/external-links";
import TurnStatsPopover from "./TurnStatsPopover";

function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface MessageBubbleProps {
  message: Message;
  streamingContent?: string;
  sessionId?: string;
  onRestart?: () => void;
  onRetry?: () => void;
}

export default React.memo(function MessageBubble({
  message,
  streamingContent,
  sessionId,
  onRestart,
  onRetry,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const displayContent = message.isStreaming
    ? streamingContent ?? ""
    : message.content;

  const timeStr = formatMessageTime(message.timestamp);
  const durationMs = message.turnStats?.durationMs;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

  if (isUser) {
    return (
      <div className="group/msg flex justify-end mb-4 min-w-0">
        <div className="flex flex-col items-end gap-0.5 max-w-[85%] min-w-0">
          <div className="relative min-w-0 max-w-full">
            <div
              className="px-4 py-2.5 rounded-2xl rounded-br-md selectable overflow-hidden"
              style={{
                background: "var(--accent-dim)",
                border: "1px solid rgba(124,58,237,0.2)",
              }}
            >
              <p className="text-chat text-text-primary whitespace-pre-wrap break-words overflow-hidden [overflow-wrap:anywhere]">
                {message.content}
              </p>
            </div>
            <button
              onClick={handleCopy}
              className="absolute -left-7 top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 rounded-md hover:bg-bg-elevated text-text-ghost hover:text-text-secondary"
              title="Copy message"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <span className="text-detail text-text-ghost px-1">{timeStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 min-w-0">
      <ActivityChip messageId={message.id} sessionId={sessionId} />
      <div className="mt-1 selectable min-w-0 overflow-hidden">
        <div className="markdown-content text-chat text-text-secondary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock,
              a: ExternalLink,
            }}
          >
            {displayContent}
          </ReactMarkdown>
          {message.isStreaming && <StreamingCursor />}
        </div>
        {/* Restart button for error/crash messages */}
        {message.restartable && onRestart && (
          <button
            onClick={onRestart}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent bg-accent/10 hover:bg-accent/20 transition-colors font-medium"
          >
            <RotateCcw size={13} />
            Restart Session
          </button>
        )}
        {/* Retry button for API errors */}
        {message.retryable && onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui text-accent bg-accent/10 hover:bg-accent/20 transition-colors font-medium"
          >
            <RotateCcw size={13} />
            Retry
          </button>
        )}
        {/* Turn stats + timestamp (shown after streaming completes) */}
        {!message.isStreaming && !message.restartable && (
          <div className="mt-1.5 flex items-center gap-2">
            {message.turnStats && <TurnStatsPopover stats={message.turnStats} />}
            <span className="text-detail text-text-ghost">
              {timeStr}
              {durationMs != null && durationMs > 0 && (
                <> · took {formatDuration(durationMs, "medium")}</>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
})
