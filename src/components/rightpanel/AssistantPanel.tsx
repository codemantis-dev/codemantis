import { useState, useRef, useEffect, useCallback } from "react";
import { Send, MessageSquare } from "lucide-react";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useAssistantSession } from "../../hooks/useAssistantSession";
import AssistantTabs from "./AssistantTabs";
import MessageBubble from "../chat/MessageBubble";

export default function AssistantPanel() {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  const projectAssistants = useAssistantStore((s) => s.projectAssistants);
  const activeAssistantIdMap = useAssistantStore((s) => s.activeAssistantId);
  const allMessages = useAssistantStore((s) => s.messages);
  const allStreaming = useAssistantStore((s) => s.streaming);
  const allBusy = useAssistantStore((s) => s.busy);
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant);

  const { createAssistant, sendMessage, closeAssistant } = useAssistantSession();

  const assistants = activeProjectPath
    ? projectAssistants.get(activeProjectPath) ?? []
    : [];
  const activeAssistantId = activeProjectPath
    ? activeAssistantIdMap.get(activeProjectPath) ?? null
    : null;

  const messages = activeAssistantId ? allMessages.get(activeAssistantId) ?? [] : [];
  const streaming = activeAssistantId ? allStreaming.get(activeAssistantId) : undefined;
  const busy = activeAssistantId ? allBusy.get(activeAssistantId) ?? false : false;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.streamingContent]);

  const handleCreate = useCallback(async () => {
    if (!activeProjectPath || creating) return;
    setCreating(true);
    try {
      await createAssistant(activeProjectPath);
    } catch (e) {
      console.error("Failed to create assistant:", e);
    } finally {
      setCreating(false);
    }
  }, [activeProjectPath, creating, createAssistant]);

  const handleClose = useCallback(async (sessionId: string) => {
    if (!activeProjectPath) return;
    await closeAssistant(activeProjectPath, sessionId);
  }, [activeProjectPath, closeAssistant]);

  const handleSelect = useCallback((sessionId: string) => {
    if (!activeProjectPath) return;
    setActiveAssistant(activeProjectPath, sessionId);
  }, [activeProjectPath, setActiveAssistant]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !activeAssistantId || busy) return;
    sendMessage(activeAssistantId, trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, activeAssistantId, busy, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    },
    []
  );

  // No project open
  if (!activeProjectPath) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-text-faint text-ui text-center">
          Open a project to use the assistant
        </p>
      </div>
    );
  }

  // No assistants yet — show empty state with create button
  if (assistants.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <MessageSquare size={24} className="text-text-faint" />
        <p className="text-text-faint text-ui text-center px-4">
          Ask questions about your project, get help with Git/GitHub, plan features, or draft content.
        </p>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="px-3 py-1.5 rounded-lg text-ui text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
        >
          {creating ? "Starting..." : "New Assistant"}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tabs */}
      <AssistantTabs
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        busyMap={allBusy}
        onSelect={handleSelect}
        onClose={handleClose}
        onCreate={handleCreate}
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {messages.length === 0 && !streaming?.isStreaming ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-4">
            <p className="text-text-faint text-ui">
              Send a message to get started.
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isCurrentlyStreaming =
                msg.isStreaming &&
                streaming?.currentMessageId === msg.id;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  sessionId={activeAssistantId ?? undefined}
                  streamingContent={
                    isCurrentlyStreaming
                      ? streaming?.streamingContent
                      : undefined
                  }
                />
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className="shrink-0 border-t p-2 flex gap-2 items-end"
        style={{ borderColor: "var(--border-light)" }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask the assistant..."
          disabled={!activeAssistantId || busy}
          rows={1}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-chat text-text-primary placeholder-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-light)",
            maxHeight: 120,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || !activeAssistantId || busy}
          className="p-1.5 rounded-lg text-accent hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Send (Cmd+Enter)"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
