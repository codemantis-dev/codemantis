import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import StreamingCursor from "./StreamingCursor";

interface ThinkingContentProps {
  content: string;
  isStreaming: boolean;
  maxHeight?: number;
  initialExpanded?: boolean;
}

export default function ThinkingContent({ content, isStreaming, maxHeight = 300, initialExpanded }: ThinkingContentProps) {
  const [expanded, setExpanded] = useState(initialExpanded ?? isStreaming);
  const scrollRef = useRef<HTMLPreElement>(null);

  // Auto-expand when streaming starts, keep user's choice otherwise
  useEffect(() => {
    if (isStreaming) setExpanded(true);
  }, [isStreaming]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (isStreaming && expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, isStreaming, expanded]);

  if (!content) return null;

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div
      className="rounded-lg overflow-hidden mb-2 transition-all duration-200"
      style={{
        borderLeft: "2px solid rgba(var(--accent-rgb, 124,58,237), 0.3)",
        background: "rgba(var(--accent-rgb, 124,58,237), 0.03)",
      }}
    >
      <button
        className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`text-text-ghost transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-label text-text-ghost font-medium">Reasoning</span>
        {!expanded && (
          <span className="text-[10px] text-text-ghost ml-auto">
            {wordCount} words
          </span>
        )}
        {isStreaming && expanded && (
          <span className="text-[10px] text-text-ghost ml-auto animate-pulse">streaming...</span>
        )}
      </button>

      {expanded && (
        <pre
          ref={scrollRef}
          className="px-3 pb-2 text-chat text-text-ghost whitespace-pre-wrap break-words overflow-y-auto [overflow-wrap:anywhere]"
          style={{ ...(maxHeight != null ? { maxHeight } : {}), fontSize: "0.85em", lineHeight: 1.5 }}
        >
          {content}
          {isStreaming && <StreamingCursor />}
        </pre>
      )}
    </div>
  );
}
