import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../types/session";
import ActivityChip from "./ActivityChip";
import StreamingCursor from "./StreamingCursor";
import CodeBlock from "./CodeBlock";

interface MessageBubbleProps {
  message: Message;
  streamingContent?: string;
}

export default function MessageBubble({
  message,
  streamingContent,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const displayContent = message.isStreaming
    ? streamingContent ?? ""
    : message.content;

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md selectable"
          style={{
            background: "var(--accent-dim)",
            border: "1px solid rgba(124,58,237,0.2)",
          }}
        >
          <p className="text-chat text-text-primary whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <ActivityChip messageId={message.id} />
      <div className="mt-1 selectable">
        <div className="markdown-content text-chat text-text-secondary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock,
            }}
          >
            {displayContent}
          </ReactMarkdown>
          {message.isStreaming && <StreamingCursor />}
        </div>
      </div>
    </div>
  );
}
