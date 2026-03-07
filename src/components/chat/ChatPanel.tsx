import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../../stores/sessionStore";
import MessageBubble from "./MessageBubble";

export default function ChatPanel() {
  const messages = useSessionStore((s) => s.messages);
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const streamingContent = useSessionStore((s) => s.streamingContent);
  const session = useSessionStore((s) => s.session);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-dim text-lg mb-2">Welcome to ClaudeForge</p>
          <p className="text-text-faint text-ui">
            Open a project to start a session
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={checkAtBottom}
      className="h-full overflow-y-auto px-6 py-4"
    >
      <div className="max-w-[720px] mx-auto">
        {messages.length === 0 && !isStreaming && (
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
              message.isStreaming ? streamingContent : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
