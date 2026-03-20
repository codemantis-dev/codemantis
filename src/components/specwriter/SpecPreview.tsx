import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string | null;
  isEditing?: boolean;
  onContentChange?: (content: string) => void;
}

export default function SpecPreview({ content, isEditing, onContentChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Auto-scroll during streaming if user was at bottom (skip in edit mode)
  useEffect(() => {
    if (isEditing) return;
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isEditing]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  // Extract title from first # heading
  const title = content?.match(/^#\s+(.+)$/m)?.[1] ?? null;

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="text-4xl mb-4">📝</div>
        <div className="text-sm font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
          Spec Preview
        </div>
        <div className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Start a conversation on the left to create your requirements specification.
          The AI will ask questions to understand your project, then write a comprehensive spec document.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {title && (
        <div
          className="px-4 py-2 text-xs font-medium border-b shrink-0 truncate"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          {title}
        </div>
      )}
      {isEditing ? (
        <textarea
          className="flex-1 w-full resize-none font-mono text-sm px-4 py-3 outline-none"
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            border: "none",
          }}
          value={content}
          onChange={(e) => onContentChange?.(e.target.value)}
        />
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3"
        >
          <div className="markdown-content text-sm" style={{ color: "var(--text-primary)" }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
