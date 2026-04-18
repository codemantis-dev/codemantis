import React from "react";
import { RotateCcw, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../types/session";
import { formatDuration, formatTime } from "../../lib/format-utils";
import ActivityChip from "./ActivityChip";
import StreamingCursor from "./StreamingCursor";
import CodeBlock from "./CodeBlock";
import { ExternalLink } from "../../lib/external-links";
import TurnStatsPopover from "./TurnStatsPopover";
import CopyButton from "../shared/CopyButton";

interface MessageBubbleProps {
  message: Message;
  streamingContent?: string;
  sessionId?: string;
  onRestart?: () => void;
  onRetry?: () => void;
  /**
   * True when this is the most recent assistant message in the thread.
   * The Copy icon is rendered always-visible for the latest reply (so
   * the user doesn't have to hunt for it), hover-only for older ones.
   */
  isLatest?: boolean;
}

export default React.memo(function MessageBubble({
  message,
  streamingContent,
  sessionId,
  onRestart,
  onRetry,
  isLatest = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const displayContent = message.isStreaming
    ? streamingContent ?? ""
    : message.content;

  const timeStr = formatTime(message.timestamp);
  const durationMs = message.turnStats?.durationMs;

  // Lazy text getter — snapshot at click time, not render time. For
  // streaming assistant messages the content keeps updating; the Copy
  // button reads whatever is current when the user clicks.
  const getCopyText = (): string => (
    message.isStreaming && streamingContent != null ? streamingContent : message.content
  );

  if (isUser) {
    const isSelfDrive = message.isSelfDrive === true;
    return (
      <div className="group/msg flex justify-end mb-4 min-w-0">
        <div className="flex flex-col items-end gap-0.5 max-w-[85%] min-w-0">
          <div className="relative min-w-0 max-w-full">
            {isSelfDrive && (
              <div
                className="flex items-center gap-1 justify-end mb-1 pr-1"
                style={{ color: "var(--green, #22c55e)" }}
              >
                <Zap size={11} />
                <span className="text-detail font-medium">Self-Drive</span>
              </div>
            )}
            <div
              className="px-4 py-2.5 rounded-2xl rounded-br-md selectable overflow-hidden"
              style={isSelfDrive ? {
                background: "rgba(34, 197, 94, 0.12)",
                border: "1px solid rgba(34, 197, 94, 0.25)",
              } : {
                background: "var(--accent-dim)",
                border: "1px solid rgba(124,58,237,0.2)",
              }}
            >
              <p className="text-chat text-text-primary whitespace-pre-wrap break-words overflow-hidden [overflow-wrap:anywhere]">
                {message.content}
              </p>
            </div>
            <CopyButton
              getText={getCopyText}
              label="Copy message"
              size={14}
              className="absolute -left-7 top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-100 transition-opacity"
            />
          </div>
          <span className="text-detail text-text-ghost px-1">{timeStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg mb-4 min-w-0">
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
        {/* Turn stats + timestamp + inline Copy. Always visible on the
            latest assistant reply, hover-only on older ones. */}
        {!message.isStreaming && !message.restartable && (
          <div className="mt-1.5 flex items-center gap-2">
            {message.turnStats && <TurnStatsPopover stats={message.turnStats} />}
            <span className="text-detail text-text-ghost">
              {timeStr}
              {durationMs != null && durationMs > 0 && (
                <> · took {formatDuration(durationMs, "medium")}</>
              )}
            </span>
            <CopyButton
              getText={getCopyText}
              label="Copy message"
              size={13}
              className={`transition-opacity ${isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}
            />
          </div>
        )}
      </div>
    </div>
  );
})
