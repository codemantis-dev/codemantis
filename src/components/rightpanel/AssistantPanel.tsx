import { useState, useRef, useEffect, useCallback } from "react";
import { Send, MessageSquare } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAssistantSession } from "../../hooks/useAssistantSession";
import AssistantTabs from "./AssistantTabs";
import AssistantMessageMenu from "./AssistantMessageMenu";
import MessageBubble from "../chat/MessageBubble";
import type { AssistantShortcut } from "../../types/settings";

export default function AssistantPanel() {
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState<{ prompt: string } | null>(null);
  const [shortcutName, setShortcutName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  const projectAssistants = useAssistantStore((s) => s.projectAssistants);
  const activeAssistantIdMap = useAssistantStore((s) => s.activeAssistantId);
  const allMessages = useAssistantStore((s) => s.messages);
  const allStreaming = useAssistantStore((s) => s.streaming);
  const allBusy = useAssistantStore((s) => s.busy);
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant);

  const shortcuts = useSettingsStore((s) => s.settings.assistantShortcuts);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

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

  const showThinking = busy && !streaming?.isStreaming;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.streamingContent, showThinking]);

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

  const handleAddShortcut = useCallback((prompt: string) => {
    setShortcutDraft({ prompt });
    setShortcutName("");
  }, []);

  const handleSaveShortcut = useCallback(() => {
    if (!shortcutDraft || !shortcutName.trim()) return;
    const newShortcut: AssistantShortcut = {
      id: crypto.randomUUID(),
      name: shortcutName.trim(),
      prompt: shortcutDraft.prompt,
    };
    updateSettings({
      assistantShortcuts: [...shortcuts, newShortcut],
    });
    setShortcutDraft(null);
    setShortcutName("");
  }, [shortcutDraft, shortcutName, shortcuts, updateSettings]);

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
          title="Create a new assistant session"
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
      <div className="flex-1 overflow-y-auto p-3 pb-8 space-y-1">
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
              const bubble = (
                <MessageBubble
                  message={msg}
                  sessionId={activeAssistantId ?? undefined}
                  streamingContent={
                    isCurrentlyStreaming
                      ? streaming?.streamingContent
                      : undefined
                  }
                />
              );
              if (msg.role === "user") {
                return (
                  <div
                    key={msg.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, text: msg.content });
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

      {/* Input area */}
      <div
        className="shrink-0 border-t"
        style={{ borderColor: "var(--border-light)" }}
      >
        {shortcuts.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pt-1.5">
            {shortcuts.map((sc) => (
              <button
                key={sc.id}
                onClick={() => setInput(sc.prompt)}
                className="px-2 py-0.5 rounded-full text-label text-text-dim hover:text-text-primary bg-bg-elevated hover:bg-accent/10 border border-border-light hover:border-accent/30 transition-colors"
                title={sc.prompt}
              >
                {sc.name}
              </button>
            ))}
          </div>
        )}
        <div className="p-2 flex gap-2 items-end">
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

      {/* Context menu */}
      {contextMenu && (
        <AssistantMessageMenu
          x={contextMenu.x}
          y={contextMenu.y}
          messageText={contextMenu.text}
          onClose={() => setContextMenu(null)}
          onAddShortcut={handleAddShortcut}
        />
      )}

      {/* Add as Shortcut modal */}
      <Dialog.Root
        open={shortcutDraft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShortcutDraft(null);
            setShortcutName("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-xl border border-border p-5 w-[360px]"
            style={{ background: "var(--bg-primary)" }}
          >
            <Dialog.Title className="text-ui text-text-primary font-semibold mb-3">
              Save as Shortcut
            </Dialog.Title>
            <div className="space-y-3">
              <div>
                <label className="text-label text-text-dim block mb-1">Name</label>
                <input
                  type="text"
                  value={shortcutName}
                  onChange={(e) => setShortcutName(e.target.value)}
                  placeholder="e.g. Code Review"
                  autoFocus
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-primary text-ui outline-none focus:border-accent/40 placeholder:text-text-ghost"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveShortcut();
                  }}
                />
              </div>
              <div>
                <label className="text-label text-text-dim block mb-1">Prompt</label>
                <p className="text-label text-text-faint bg-bg-elevated rounded-lg px-3 py-2 max-h-24 overflow-y-auto border border-border-light">
                  {shortcutDraft?.prompt.slice(0, 200)}
                  {(shortcutDraft?.prompt.length ?? 0) > 200 && "..."}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setShortcutDraft(null); setShortcutName(""); }}
                  className="px-3 py-1.5 rounded-lg text-ui text-text-secondary border border-border hover:bg-bg-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveShortcut}
                  disabled={!shortcutName.trim()}
                  className="px-3 py-1.5 rounded-lg text-ui text-white bg-accent hover:bg-accent-light transition-colors font-medium disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
