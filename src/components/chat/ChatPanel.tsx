import { useEffect, useRef, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import MessageBubble from "./MessageBubble";
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // Re-scroll to bottom when scroll container resizes (e.g., ThinkingIndicator appears/grows
  // with sub-agent cards). Without this, the container shrinks but scrollTop stays the same,
  // causing the user to appear "scrolled up" and triggering the "New messages" button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current && el) {
        el.scrollTop = el.scrollHeight;
      }
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
          <div className="max-w-[720px] mx-auto">
            {messages.length === 0 && !streaming.isStreaming && (
              <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: "calc(100vh - 240px)" }}>
                <img src="/codemantis_app_icon.png" alt="CodeMantis" className="w-20 h-20 opacity-30" />
                <p className="text-text-dim text-ui">
                  Send a message to start the conversation
                </p>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                streamingContent={
                  message.isStreaming ? streaming.streamingContent : undefined
                }
                onRestart={message.restartable ? handleRestart : undefined}
              />
            ))}
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
          <div className="max-w-[720px] mx-auto">
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
