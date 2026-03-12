import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { ArrowDown } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import MessageBubble from "./MessageBubble";
import ThinkingIndicator from "./ThinkingIndicator";
import SessionStatusBar from "./SessionStatusBar";

export default function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);
  const sessions = useSessionStore((s) => s.sessions);

  const messages = useMemo(
    () => activeSessionId ? sessionMessages.get(activeSessionId) ?? [] : [],
    [activeSessionId, sessionMessages]
  );
  const streaming = activeSessionId
    ? sessionStreaming.get(activeSessionId) ?? { isStreaming: false, streamingContent: "", currentMessageId: null }
    : { isStreaming: false, streamingContent: "", currentMessageId: null };
  const sessionBusy = useSessionStore((s) => s.sessionBusy);
  const session = activeSessionId ? sessions.get(activeSessionId) ?? null : null;
  const isBusy = activeSessionId ? sessionBusy.get(activeSessionId) ?? false : false;
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

  const handleContentResize = useCallback(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
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
      <div
        ref={scrollRef}
        onScroll={checkAtBottom}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="max-w-[720px] mx-auto">
          {messages.length === 0 && !streaming.isStreaming && (
            <div className="text-center py-16">
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

          {/* Working indicator — show when busy but no text is streaming yet */}
          {isBusy && !streaming.isStreaming && activeSessionId && (
            <ThinkingIndicator sessionId={activeSessionId} onContentResize={handleContentResize} />
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-text-secondary text-ui shadow-lg hover:brightness-95 transition-colors z-10"
          style={{ background: "var(--bg-primary)" }}
        >
          <ArrowDown size={13} />
          <span>New messages</span>
        </button>
      )}

      {/* Session status bar — always visible at bottom */}
      {activeSessionId && (
        <SessionStatusBar sessionId={activeSessionId} />
      )}
    </div>
  );
}
