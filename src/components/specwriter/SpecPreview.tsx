import { useRef, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownLinkComponents } from "../../lib/external-links";
import type { SpecPreviewTab } from "../../types/spec-writer";

const REMARK_PLUGINS = [remarkGfm];

export type { SpecPreviewTab };

interface Props {
  content: string | null;
  auditContent?: string | null;
  /**
   * True between Generate Audit click and the stream's terminal event.
   * Used to render a placeholder Verification… tab so the user can see the
   * audit slot exists even before content has streamed in.
   */
  auditPending?: boolean;
  activeTab: SpecPreviewTab;
  onTabChange: (tab: SpecPreviewTab) => void;
  /** Stage 3: Show the Coverage tab and its content (rendered in `coverageSlot` when active). */
  hasCoverage?: boolean;
  /** Stage 3: Badge count shown next to the Coverage tab when failures are present. */
  coverageFailureCount?: number;
  /** Stage 3: Rendered when activeTab === 'coverage'. */
  coverageSlot?: React.ReactNode;
  isEditing?: boolean;
  onContentChange?: (content: string) => void;
  onClose?: () => void;
}

export default function SpecPreview({
  content,
  auditContent,
  auditPending = false,
  activeTab,
  onTabChange,
  hasCoverage = false,
  coverageFailureCount = 0,
  coverageSlot,
  isEditing,
  onContentChange,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Show the audit tab whenever we have content for it OR a generation is in
  // flight; this lets the tab persist across project switches during streaming.
  const auditTabVisible = !!auditContent || auditPending;
  const showTabBar = (!!content && auditTabVisible) || hasCoverage || auditPending;
  const auditAwaitingFirstChunk = activeTab === 'audit' && auditPending && !auditContent;

  // When the audit tab is selected but no content has streamed in yet, show
  // a small placeholder rather than falling back to the spec content (which
  // would be confusing — same content, different tab).
  const displayContent = activeTab === 'audit'
    ? (auditContent ?? null)
    : content;

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

  if (!content && !auditContent && !hasCoverage && !auditPending) {
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
      {/* Tab bar — when audit or coverage is available */}
      {showTabBar && (
        <div
          className="flex shrink-0 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          {(content || activeTab === 'spec') && (
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
          )}
          {auditTabVisible && (
            <button
              onClick={() => onTabChange('audit')}
              className="px-4 py-2 text-ui font-medium transition-colors"
              style={{
                color: activeTab === 'audit' ? "var(--accent)" : "var(--text-secondary)",
                borderBottom: activeTab === 'audit' ? "2px solid var(--accent)" : "2px solid transparent",
                background: activeTab === 'audit' ? "var(--accent-bg)" : "transparent",
              }}
            >
              {auditContent ? "Verification Audit" : "Verification…"}
            </button>
          )}
          {hasCoverage && (
            <button
              onClick={() => onTabChange('coverage')}
              className="px-4 py-2 text-ui font-medium transition-colors flex items-center gap-1.5"
              style={{
                color: activeTab === 'coverage' ? "var(--accent)" : "var(--text-secondary)",
                borderBottom: activeTab === 'coverage' ? "2px solid var(--accent)" : "2px solid transparent",
                background: activeTab === 'coverage' ? "var(--accent-bg)" : "transparent",
              }}
            >
              Coverage
              {coverageFailureCount > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] px-1 rounded-full text-detail font-mono"
                  style={{
                    background: "var(--destructive, #ef4444)",
                    color: "white",
                  }}
                >
                  {coverageFailureCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Coverage tab body */}
      {activeTab === 'coverage' && hasCoverage && (
        <div className="flex-1 overflow-hidden">
          {coverageSlot}
        </div>
      )}

      {title && activeTab !== 'coverage' && (
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
      {activeTab !== 'coverage' && (
        auditAwaitingFirstChunk ? (
          <div className="flex-1 overflow-y-auto flex items-center justify-center px-6">
            <div className="flex flex-col items-center gap-3 text-center max-w-sm">
              <div className="relative w-8 h-8">
                <div
                  className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
                />
              </div>
              <div className="text-chat font-medium" style={{ color: "var(--text-secondary)" }}>
                Generating Verification Audit…
              </div>
              <div className="text-ui leading-relaxed" style={{ color: "var(--text-dim)" }}>
                The audit document will appear here as it streams in. The Specification tab still has your spec.
              </div>
            </div>
          </div>
        ) : isEditing && activeTab === 'spec' ? (
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
        )
      )}
    </div>
  );
}
