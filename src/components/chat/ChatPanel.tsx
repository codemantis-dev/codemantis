import { useEffect, useRef, useCallback, useState } from "react";
import { ArrowDown, Sparkles, X } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { useChatIncrementalLoad } from "../../hooks/useChatIncrementalLoad";
import { readFileContent, generateClaudeMd } from "../../lib/tauri-commands";
import { showToast } from "../../stores/toastStore";
import MessageBubble from "./MessageBubble";
import SelfDriveDecisionCard from "./SelfDriveDecisionCard";
import ThinkingIndicator from "./ThinkingIndicator";
import SessionStatusBar from "./SessionStatusBar";
import { EMPTY_ARRAY, EMPTY_STREAMING } from "../../lib/empty-refs";

export default function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useSessionStore((s) => s.activeSessionId ? s.sessionMessages.get(s.activeSessionId) ?? EMPTY_ARRAY : EMPTY_ARRAY);
  const streaming = useSessionStore((s) => s.activeSessionId ? s.sessionStreaming.get(s.activeSessionId) ?? EMPTY_STREAMING : EMPTY_STREAMING);
  const session = useSessionStore((s) => s.activeSessionId ? s.sessions.get(s.activeSessionId) ?? null : null);
  const isBusy = useSessionStore((s) => s.activeSessionId ? s.sessionBusy.get(s.activeSessionId) ?? false : false);
  const { startSession } = useClaudeSession();

  const handleRestart = useCallback(() => {
    if (!session) return;
    startSession(session.project_path).catch((e) =>
      console.error("Failed to restart session:", e)
    );
  }, [session, startSession]);

  // CLAUDE.md suggestion banner
  const [showClaudeMdBanner, setShowClaudeMdBanner] = useState(false);
  const [generatingClaudeMd, setGeneratingClaudeMd] = useState(false);
  const claudeMdCheckedRef = useRef<string | null>(null);

  useEffect(() => {
    const projectPath = session?.project_path;
    if (!projectPath) {
      setShowClaudeMdBanner(false);
      claudeMdCheckedRef.current = null;
      return;
    }
    // Only check once per project path
    if (claudeMdCheckedRef.current === projectPath) return;
    claudeMdCheckedRef.current = projectPath;

    const claudeMdPath = `${projectPath}/CLAUDE.md`;
    readFileContent(claudeMdPath)
      .then(() => setShowClaudeMdBanner(false))
      .catch(() => setShowClaudeMdBanner(true));
  }, [session?.project_path]);

  const handleGenerateClaudeMd = useCallback(async () => {
    if (!session) return;
    setGeneratingClaudeMd(true);
    try {
      await generateClaudeMd(session.project_path);
      showToast("CLAUDE.md generated — Claude Code will use it in your next session", "success");
      setShowClaudeMdBanner(false);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("already exists")) {
        showToast("CLAUDE.md already exists", "info");
        setShowClaudeMdBanner(false);
      } else {
        showToast("Failed to generate CLAUDE.md", "error");
      }
    } finally {
      setGeneratingClaudeMd(false);
    }
  }, [session]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const lastClientHeightRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const { startIndex, hasOlder, remainingCount, loadAll, sentinelRef } = useChatIncrementalLoad({
    totalCount: messages.length,
    resetKey: activeSessionId,
    scrollRef,
  });
  const visibleMessages = messages.slice(startIndex);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Scroll events also fire on container reflows (e.g. ThinkingIndicator growing shrinks
    // clientHeight). Those aren't real user scrolls — swallow them and let the ResizeObserver
    // settle the flags with a consistent post-resize measurement.
    if (el.clientHeight !== lastClientHeightRef.current) {
      lastClientHeightRef.current = el.clientHeight;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Re-scroll to bottom when scroll container resizes (e.g., ThinkingIndicator appears/grows
  // with sub-agent cards). Without this, the container shrinks but scrollTop stays the same,
  // causing the user to appear "scrolled up" and triggering the "New messages" button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    lastClientHeightRef.current = el.clientHeight;

    const observer = new ResizeObserver(() => {
      const node = scrollRef.current;
      if (!node) return;
      if (isAtBottomRef.current) {
        node.scrollTop = node.scrollHeight;
      }
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom);
      lastClientHeightRef.current = node.clientHeight;
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Force-scroll to bottom when the user sends a new message (even if scrolled up)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (messages.length > prevCount && prevCount > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        // User just sent a message — always scroll to bottom
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          isAtBottomRef.current = true;
          setShowScrollButton(false);
        }
        return;
      }
    }

    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming.streamingContent, isBusy]);

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim text-lg mb-2">Welcome to CodeMantis</p>
          <p className="text-text-faint text-ui">
            Open a project to start a session
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={checkAtBottom}
          className="h-full overflow-y-auto px-6 py-4"
        >
          <div className="max-w-[1080px] mx-auto">
            {messages.length === 0 && !streaming.isStreaming && (
              <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: "calc(100vh - 240px)" }}>
                <img src="/CodeMantisIcon.png" alt="CodeMantis" className="w-20 h-20 opacity-30" />
                <p className="text-text-dim text-ui">
                  Send a message to start the conversation
                </p>
              </div>
            )}

            {/* CLAUDE.md suggestion banner */}
            {showClaudeMdBanner && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-accent/20 bg-accent/5 flex items-center gap-3">
                <Sparkles size={16} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-text-secondary text-ui">
                    This project doesn&apos;t have a CLAUDE.md file.
                  </p>
                  <p className="text-text-dim text-label">
                    Claude Code works better with one.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleGenerateClaudeMd}
                    disabled={generatingClaudeMd}
                    className="px-3 py-1.5 rounded-md bg-accent text-white text-label font-medium hover:bg-accent-light disabled:opacity-60 transition-colors"
                  >
                    {generatingClaudeMd ? "Generating..." : "Generate CLAUDE.md"}
                  </button>
                  <button
                    onClick={() => setShowClaudeMdBanner(false)}
                    className="p-1 rounded-md text-text-ghost hover:text-text-dim transition-colors"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {hasOlder && (
              <>
                <div ref={sentinelRef} className="h-1" />
                <button
                  onClick={loadAll}
                  className="w-full py-1.5 text-detail text-text-ghost hover:text-text-dim transition-colors"
                >
                  Load all {remainingCount} older messages
                </button>
              </>
            )}
            {visibleMessages.map((message, index) => {
              const isRestoredBoundary =
                message.isRestored &&
                index < visibleMessages.length - 1 &&
                !visibleMessages[index + 1].isRestored;

              // Mark the most recent assistant bubble (skipping Self-Drive
              // decision cards) so MessageBubble can render the Copy icon
              // as always-visible on the latest AI response.
              let isLatestAssistant = false;
              if (message.role === "assistant" && !message.selfDriveEvent) {
                isLatestAssistant = true;
                for (let j = index + 1; j < visibleMessages.length; j++) {
                  const later = visibleMessages[j];
                  if (later.role === "assistant" && !later.selfDriveEvent) {
                    isLatestAssistant = false;
                    break;
                  }
                }
              }

              return (
                <div key={message.id}>
                  {message.selfDriveEvent ? (
                    <SelfDriveDecisionCard
                      event={message.selfDriveEvent}
                      timestamp={message.timestamp}
                    />
                  ) : (
                    <MessageBubble
                      message={message}
                      streamingContent={
                        message.isStreaming ? streaming.streamingContent : undefined
                      }
                      onRestart={message.restartable ? handleRestart : undefined}
                      isLatest={isLatestAssistant}
                    />
                  )}
                  {isRestoredBoundary && (
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 border-t border-border-light" />
                      <span className="text-detail text-text-ghost font-medium uppercase tracking-wider">
                        Previous session
                      </span>
                      <div className="flex-1 border-t border-border-light" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-text-secondary text-ui shadow-lg hover:brightness-95 transition-colors z-10"
            style={{ background: "var(--bg-primary)" }}
          >
            <ArrowDown size={13} />
            <span>New messages</span>
          </button>
        )}
      </div>

      {/* ThinkingIndicator — pinned outside scroll area for guaranteed visibility */}
      {isBusy && !streaming.isStreaming && activeSessionId && (
        <div className="shrink-0 px-6 pt-3 pb-2 border-t border-border" style={{ background: "var(--bg-primary)" }}>
          <div className="max-w-[1080px] mx-auto">
            <ThinkingIndicator sessionId={activeSessionId} />
          </div>
        </div>
      )}

      {/* Session status bar — always visible at bottom */}
      {activeSessionId && (
        <SessionStatusBar sessionId={activeSessionId} />
      )}
    </div>
  );
}
