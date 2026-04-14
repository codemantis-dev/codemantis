import { useEffect, useRef } from "react";
import type { Message } from "../../types/session";
import { useUiStore } from "../../stores/uiStore";
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
  const rightTab = useUiStore((s) => s.rightTab);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.streamingContent, showThinking]);

  // Scroll to bottom when the Assistant tab becomes visible again
  useEffect(() => {
    if (rightTab === "assistant") {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [rightTab]);

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
