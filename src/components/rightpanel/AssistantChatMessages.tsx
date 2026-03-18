import React from "react";
import type { Message } from "../../types/session";
import MessageBubble from "../chat/MessageBubble";

interface StreamingInfo {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
}

interface AssistantChatMessagesProps {
  messages: Message[];
  streaming: StreamingInfo | undefined;
  showThinking: boolean;
  activeAssistantId: string | null;
  isClaudeCode: boolean;
  onContextMenu: (e: React.MouseEvent, text: string) => void;
  onRetry?: (sessionId: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export default React.memo(function AssistantChatMessages({
  messages,
  streaming,
  showThinking,
  activeAssistantId,
  isClaudeCode,
  onContextMenu,
  onRetry,
  messagesEndRef,
}: AssistantChatMessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 pb-8 space-y-1">
      {messages.length === 0 && !streaming?.isStreaming ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4">
          <p className="text-text-faint text-ui">
            {isClaudeCode
              ? "Send a message or use / commands to get started."
              : "Send a message to get started."}
          </p>
        </div>
      ) : (
        <>
          {messages.map((msg) => {
            const isCurrentlyStreaming =
              msg.isStreaming &&
              streaming?.currentMessageId === msg.id;
            const bubble = (
              <MessageBubble
                message={msg}
                sessionId={activeAssistantId ?? undefined}
                streamingContent={
                  isCurrentlyStreaming
                    ? streaming?.streamingContent
                    : undefined
                }
                onRetry={msg.retryable && activeAssistantId && onRetry
                  ? () => onRetry(activeAssistantId)
                  : undefined}
              />
            );
            if (msg.role === "user") {
              return (
                <div
                  key={msg.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, msg.content);
                  }}
                >
                  {bubble}
                </div>
              );
            }
            return <div key={msg.id}>{bubble}</div>;
          })}
        </>
      )}
      {showThinking && (
        <div className="mb-4 flex items-center gap-1.5 px-1">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 rounded-full bg-accent/60 animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
          <span className="text-label text-text-faint">Thinking...</span>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
})
