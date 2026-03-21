import { useEffect, useRef, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../../stores/sessionStore";
import StreamingCursor from "../chat/StreamingCursor";
import CodeBlock from "../chat/CodeBlock";
import { EMPTY_ARRAY, EMPTY_STREAMING } from "../../lib/empty-refs";

/** Number of initial messages to hide (system prompt + acknowledgment). */
const HIDDEN_PREFIX = 2;

interface HelpChatProps {
  sessionId: string;
}

export default function HelpChat({ sessionId }: HelpChatProps) {
  const allMessages = useSessionStore(
    (s) => s.sessionMessages.get(sessionId) ?? EMPTY_ARRAY
  );
  const streaming = useSessionStore(
    (s) => s.sessionStreaming.get(sessionId) ?? EMPTY_STREAMING
  );

  // Filter out the system prompt injection and Claude's acknowledgment
  const messages = allMessages.slice(HIDDEN_PREFIX);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, []);

  // Auto-scroll on new messages / streaming content
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = messages.length;

    // Always scroll for new user messages
    if (messages.length > prev && prev > 0) {
      const last = messages[messages.length - 1];
      if (last?.role === "user" && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        isAtBottomRef.current = true;
        setShowScrollBtn(false);
        return;
      }
    }

    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming.streamingContent]);

  // ResizeObserver to keep scroll pinned when content grows
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

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={checkAtBottom}
        className="h-full overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-col gap-4">
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const displayContent =
              msg.isStreaming && streaming.streamingContent
                ? streaming.streamingContent
                : msg.content;

            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div
                    className="px-3 py-2 rounded-2xl rounded-br-md max-w-[85%] text-sm"
                    style={{
                      background: "var(--accent-dim)",
                      border: "1px solid rgba(124,58,237,0.2)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[95%] text-sm markdown-content" style={{ color: "var(--text-secondary)" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
                    {displayContent}
                  </ReactMarkdown>
                  {msg.isStreaming && <StreamingCursor />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-ui shadow-lg hover:brightness-95 transition-colors z-10"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            background: "var(--bg-primary)",
          }}
        >
          <ArrowDown size={13} />
          <span>New messages</span>
        </button>
      )}
    </div>
  );
}
