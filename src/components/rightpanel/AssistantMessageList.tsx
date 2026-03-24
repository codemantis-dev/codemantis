import { useEffect, useRef } from "react";
import type { Message } from "../../types/session";
import AssistantChatMessages from "./AssistantChatMessages";

interface StreamingInfo {
  isStreaming: boolean;
  streamingContent: string;
  currentMessageId: string | null;
}

interface AssistantMessageListProps {
  messages: Message[];
  streaming: StreamingInfo | undefined;
  showThinking: boolean;
  activeAssistantId: string | null;
  isClaudeCode: boolean;
  onContextMenu: (e: React.MouseEvent, text: string) => void;
  onRetry: (sessionId: string) => void;
}

export default function AssistantMessageList({
  messages,
  streaming,
  showThinking,
  activeAssistantId,
  isClaudeCode,
  onContextMenu,
  onRetry,
}: AssistantMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.streamingContent, showThinking]);

  return (
    <AssistantChatMessages
      messages={messages}
      streaming={streaming}
      showThinking={showThinking}
      activeAssistantId={activeAssistantId}
      isClaudeCode={isClaudeCode}
      onContextMenu={onContextMenu}
      onRetry={onRetry}
      messagesEndRef={messagesEndRef}
    />
  );
}
