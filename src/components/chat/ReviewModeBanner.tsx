import { useCallback, useState } from "react";
import { Eye, EyeOff, ScrollText, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../../stores/sessionStore";

/**
 * Codex review-mode banner. Mounted above the chat message list in
 * ChatPanel. Renders when:
 *  - the active session is in `review` mode, OR
 *  - a review just ended (sessionReviewContent still populated by
 *    ReviewModeExited) and the user hasn't dismissed it yet.
 *
 * Mirrors the style of `PlanPendingBanner` so the in-chat affordances
 * stay consistent across agent surfaces. Phase 2 spec §2.4.4 explicitly
 * defers a deeper review surface (right-panel tab) to a future phase;
 * this banner is the minimum-viable user signal.
 *
 * Lifecycle:
 *   ReviewModeEntered  → sessionMode = "review",
 *                        sessionReviewContent = review text
 *   ReviewModeExited   → sessionMode = "normal",
 *                        sessionReviewContent = final review text
 *   User dismiss       → sessionReviewContent cleared (banner hides)
 *
 * The schemas for both lifecycle items live at
 * docs/internal/codex-app-server-schemas/v2/ItemStartedNotification.json
 * lines 1104–1150.
 */
export default function ReviewModeBanner(): React.ReactElement | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionModes = useSessionStore((s) => s.sessionModes);
  const sessionReviewContent = useSessionStore((s) => s.sessionReviewContent);
  const setSessionReviewContent = useSessionStore(
    (s) => s.setSessionReviewContent,
  );

  const [expanded, setExpanded] = useState(true);

  const mode = activeSessionId ? sessionModes.get(activeSessionId) : undefined;
  const review = activeSessionId
    ? sessionReviewContent.get(activeSessionId)
    : undefined;

  const handleDismiss = useCallback(() => {
    if (!activeSessionId) return;
    setSessionReviewContent(activeSessionId, "");
  }, [activeSessionId, setSessionReviewContent]);

  const handleToggle = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  // No banner if there's no review content for this session.
  if (!review) return null;

  const inReview = mode === "review";

  return (
    <div
      className="mb-2 rounded-lg border border-border bg-bg-subtle overflow-hidden"
      role="status"
      aria-label={
        inReview ? "Codex review in progress" : "Codex review summary"
      }
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <ScrollText size={14} className="shrink-0 text-accent" />
        <span className="text-ui text-text-primary font-medium shrink-0">
          {inReview ? "Codex review in progress" : "Codex review summary"}
        </span>
        <span className="flex-1" />
        <button
          onClick={handleToggle}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
          title={expanded ? "Collapse review" : "Expand review"}
        >
          {expanded ? <EyeOff size={12} /> : <Eye size={12} />}
          <span>{expanded ? "Collapse" : "Expand"}</span>
        </button>
        {!inReview && (
          <button
            onClick={handleDismiss}
            className="w-6 h-6 flex items-center justify-center rounded-md text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
            title="Dismiss — clear review summary"
            aria-label="Dismiss review summary"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border-light prose prose-sm max-w-none text-text-secondary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{review}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
