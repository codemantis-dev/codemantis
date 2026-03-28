import { useRef, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownLinkComponents } from "../../lib/external-links";

const REMARK_PLUGINS = [remarkGfm];

interface Props {
  content: string | null;
  auditContent?: string | null;
  activeTab: 'spec' | 'audit';
  onTabChange: (tab: 'spec' | 'audit') => void;
  isEditing?: boolean;
  onContentChange?: (content: string) => void;
  onClose?: () => void;
}

export default function SpecPreview({ content, auditContent, activeTab, onTabChange, isEditing, onContentChange, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const hasBothDocuments = !!content && !!auditContent;

  const displayContent = activeTab === 'audit' && auditContent ? auditContent : content;

  // Memoize markdown rendering — only re-parse when content changes
  const renderedMarkdown = useMemo(
    () => <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownLinkComponents}>{displayContent ?? ""}</ReactMarkdown>,
    [displayContent]
  );

  // Auto-scroll during streaming if user was at bottom (skip in edit mode)
  useEffect(() => {
    if (isEditing) return;
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [displayContent, isEditing]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  // Extract title from first # heading of the currently displayed content
  const title = displayContent?.match(/^#\s+(.+)$/m)?.[1] ?? null;

  if (!content && !auditContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <div className="text-4xl mb-4">📝</div>
        <div className="text-chat font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
          Spec Preview
        </div>
        <div className="text-ui leading-relaxed" style={{ color: "var(--text-dim)" }}>
          Start a conversation on the left to create your requirements specification.
          The AI will ask questions to understand your project, then write a comprehensive spec document.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — only when both documents exist */}
      {hasBothDocuments && (
        <div
          className="flex shrink-0 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={() => onTabChange('spec')}
            className="px-4 py-2 text-ui font-medium transition-colors"
            style={{
              color: activeTab === 'spec' ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: activeTab === 'spec' ? "2px solid var(--accent)" : "2px solid transparent",
              background: activeTab === 'spec' ? "var(--accent-bg)" : "transparent",
            }}
          >
            Specification
          </button>
          <button
            onClick={() => onTabChange('audit')}
            className="px-4 py-2 text-ui font-medium transition-colors"
            style={{
              color: activeTab === 'audit' ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: activeTab === 'audit' ? "2px solid var(--accent)" : "2px solid transparent",
              background: activeTab === 'audit' ? "var(--accent-bg)" : "transparent",
            }}
          >
            Verification Audit
          </button>
        </div>
      )}

      {title && (
        <div
          className="px-4 py-2 text-ui font-medium border-b shrink-0 flex items-center gap-2"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          <span className="truncate flex-1">{title}</span>
          {onClose && (
            <button
              onClick={onClose}
              title="Close spec"
              className="shrink-0 p-0.5 rounded hover:bg-bg-elevated transition-colors"
              style={{ color: "var(--text-ghost)" }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
      {isEditing && activeTab === 'spec' ? (
        <textarea
          className="flex-1 w-full resize-none font-mono text-chat px-4 py-3 outline-none"
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            border: "none",
          }}
          value={displayContent ?? ""}
          onChange={(e) => onContentChange?.(e.target.value)}
        />
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-3"
        >
          <div className="markdown-content text-chat" style={{ color: "var(--text-primary)" }}>
            {renderedMarkdown}
          </div>
        </div>
      )}
    </div>
  );
}
