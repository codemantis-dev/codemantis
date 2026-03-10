import { useEffect, useRef, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import MessageBubble from "./MessageBubble";
import ThinkingIndicator from "./ThinkingIndicator";

export default function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const sessionStreaming = useSessionStore((s) => s.sessionStreaming);
  const sessions = useSessionStore((s) => s.sessions);

  const messages = activeSessionId ? sessionMessages.get(activeSessionId) ?? [] : [];
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

  useEffect(() => {
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
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={checkAtBottom}
        className="h-full overflow-y-auto px-6 py-4"
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
          {isBusy && !streaming.isStreaming && (
            <ThinkingIndicator />
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-elevated border border-border text-text-secondary text-ui shadow-lg hover:bg-bg-subtle transition-colors"
        >
          <ArrowDown size={13} />
          <span>New messages</span>
        </button>
      )}
    </div>
  );
}
