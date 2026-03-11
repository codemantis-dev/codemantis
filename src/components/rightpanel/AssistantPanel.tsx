import { useState, useRef, useEffect, useCallback } from "react";
import { Send, MessageSquare, Info } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAssistantSession } from "../../hooks/useAssistantSession";
import { AI_PROVIDERS, AI_MODELS } from "../../types/assistant-provider";
import type { AIProvider, APIProvider } from "../../types/assistant-provider";
import type { SlashCommand } from "../../types/slash-commands";
import { discoverCommands, expandSkill } from "../../lib/tauri-commands";
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
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const commandPaletteRef = useRef<HTMLDivElement>(null);

  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);

  const projectAssistants = useAssistantStore((s) => s.projectAssistants);
  const activeAssistantIdMap = useAssistantStore((s) => s.activeAssistantId);
  const allMessages = useAssistantStore((s) => s.messages);
  const allStreaming = useAssistantStore((s) => s.streaming);
  const allBusy = useAssistantStore((s) => s.busy);
  const allCost = useAssistantStore((s) => s.sessionCost);
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant);

  const shortcuts = useSettingsStore((s) => s.settings.assistantShortcuts);
  const apiKeys = useSettingsStore((s) => s.settings.apiKeys);
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

  // Find current assistant instance for provider-specific behavior
  const activeInstance = activeAssistantId
    ? assistants.find((a) => a.id === activeAssistantId)
    : undefined;
  const isClaudeCode = activeInstance?.provider === "claude-code";
  const isApiProvider = activeInstance && activeInstance.provider !== "claude-code";

  const showThinking = busy && !streaming?.isStreaming;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.streamingContent, showThinking]);

  // Load commands for slash command palette (Claude Code assistants only)
  useEffect(() => {
    if (!activeProjectPath) return;
    discoverCommands(activeProjectPath)
      .then(setCommands)
      .catch((e) => console.error("[assistant] Failed to discover commands:", e));
  }, [activeProjectPath]);

  // Close provider menu on click outside
  useEffect(() => {
    if (!showProviderMenu) return;
    const handler = (e: MouseEvent) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(e.target as Node)) {
        setShowProviderMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProviderMenu]);

  // Close command palette on click outside
  useEffect(() => {
    if (!showCommandPalette) return;
    const handler = (e: MouseEvent) => {
      if (commandPaletteRef.current && !commandPaletteRef.current.contains(e.target as Node)) {
        setShowCommandPalette(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCommandPalette]);

  const handleCreate = useCallback(async (provider: AIProvider = "claude-code", model?: string) => {
    if (!activeProjectPath || creating) return;

    // Check API key for non-claude-code providers
    if (provider !== "claude-code" && !(apiKeys[provider] ?? "").trim()) {
      return; // shouldn't happen since button is disabled, but guard
    }

    setCreating(true);
    setShowProviderMenu(false);
    try {
      await createAssistant(activeProjectPath, provider, model);
    } catch (e) {
      console.error("Failed to create assistant:", e);
    } finally {
      setCreating(false);
    }
  }, [activeProjectPath, creating, createAssistant, apiKeys]);

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

    // Handle slash commands for Claude Code assistants
    if (isClaudeCode && trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      return;
    }

    sendMessage(activeAssistantId, trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, activeAssistantId, busy, sendMessage, isClaudeCode]);

  const handleSlashCommand = useCallback(async (rawInput: string) => {
    if (!activeAssistantId || !activeProjectPath) return;

    const withoutSlash = rawInput.slice(1);
    const [cmdName, ...argParts] = withoutSlash.split(/\s+/);
    const args = argParts.join(" ");

    const cmd = commands.find((c) => c.name.toLowerCase() === cmdName.toLowerCase());
    if (!cmd) {
      // Not a recognized command — send as-is
      sendMessage(activeAssistantId, rawInput);
      setInput("");
      return;
    }

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      if (cmd.category === "skill" && cmd.source_path) {
        const session = useSessionStore.getState().sessions.get(activeAssistantId);
        const cliSessionId = session?.cli_session_id ?? "";
        const expanded = await expandSkill(activeProjectPath, cmd.source_path, args, cliSessionId);
        if (expanded.prompt.trim()) {
          sendMessage(activeAssistantId, expanded.prompt);
        }
      } else if (cmd.category === "built-in") {
        // Handle built-in commands within assistant context
        const store = useAssistantStore.getState();
        const sysMsg = (content: string) => {
          store.addMessage(activeAssistantId, {
            id: `sys-${Date.now()}`,
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            activityIds: [],
            isStreaming: false,
          });
        };
        switch (cmd.name) {
          case "help":
            sysMsg("**Available Commands**\n\nType `/` to see available slash commands. Skills from `.claude/commands/` will be expanded and sent as prompts.");
            break;
          case "clear":
            store.clearMessages(activeAssistantId);
            break;
          default:
            // For other built-in commands, send as regular message to Claude
            sendMessage(activeAssistantId, rawInput);
            break;
        }
      } else {
        // cli-only or unknown: send as regular message
        sendMessage(activeAssistantId, rawInput);
      }
    } catch (e) {
      console.error("[assistant] Slash command error:", e);
    }
  }, [activeAssistantId, activeProjectPath, commands, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Command palette navigation
      if (showCommandPalette) {
        const filtered = getFilteredCommands();
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setCommandIndex((i) => Math.min(i + 1, filtered.length - 1));
            return;
          case "ArrowUp":
            e.preventDefault();
            setCommandIndex((i) => Math.max(i - 1, 0));
            return;
          case "Enter":
            e.preventDefault();
            if (filtered[commandIndex]) {
              const cmd = filtered[commandIndex];
              const parts = commandQuery.split(/\s+/);
              const args = parts.length > 1 ? parts.slice(1).join(" ") : "";
              setShowCommandPalette(false);
              setInput("");
              if (textareaRef.current) textareaRef.current.style.height = "auto";
              // Execute the command
              if (cmd.category === "skill" && cmd.source_path && activeProjectPath && activeAssistantId) {
                const session = useSessionStore.getState().sessions.get(activeAssistantId);
                expandSkill(activeProjectPath, cmd.source_path, args, session?.cli_session_id ?? "")
                  .then((expanded) => {
                    if (expanded.prompt.trim()) sendMessage(activeAssistantId, expanded.prompt);
                  })
                  .catch(console.error);
              } else {
                handleSlashCommand("/" + cmd.name + (args ? " " + args : ""));
              }
            }
            return;
          case "Escape":
            e.preventDefault();
            setShowCommandPalette(false);
            setInput("");
            return;
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showCommandPalette, commandIndex, commandQuery, activeProjectPath, activeAssistantId, sendMessage, handleSlashCommand]
  );

  const getFilteredCommands = useCallback((): SlashCommand[] => {
    if (!commandQuery) return commands;
    const q = commandQuery.toLowerCase().split(/\s/)[0];
    return commands.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [commands, commandQuery]);

  // Auto-resize textarea + slash command detection
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";

      // Slash command detection for Claude Code assistants
      if (isClaudeCode && value.startsWith("/")) {
        const query = value.slice(1);
        setCommandQuery(query);
        setShowCommandPalette(true);
        setCommandIndex(0);
      } else {
        setShowCommandPalette(false);
      }
    },
    [isClaudeCode]
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

  // No assistants yet — show empty state with provider selection
  if (assistants.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
        <MessageSquare size={24} className="text-text-faint" />
        <p className="text-text-faint text-ui text-center">
          Ask questions about your project, get help with code, or chat with AI.
        </p>
        <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
          {AI_PROVIDERS.map((p) => {
            const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
            const models = p.id !== "claude-code" ? AI_MODELS[p.id as APIProvider] : [];
            const defaultModel = models.length > 0 ? models[0].id : undefined;
            return (
              <button
                key={p.id}
                onClick={() => handleCreate(p.id, defaultModel)}
                disabled={creating || !hasKey}
                className="px-3 py-2 rounded-lg text-ui text-left transition-colors border border-border-light hover:border-accent/30 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed"
                title={!hasKey ? `Set API key in Settings > AI Providers` : `New ${p.label} assistant`}
              >
                <span className="text-text-primary">{p.label}</span>
                {!hasKey && (
                  <span className="text-[10px] text-text-ghost block">No API key</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const filteredCommands = getFilteredCommands();

  return (
    <div className="h-full flex flex-col">
      {/* Sub-tabs */}
      <AssistantTabs
        assistants={assistants}
        activeAssistantId={activeAssistantId}
        busyMap={allBusy}
        costMap={allCost}
        onSelect={handleSelect}
        onClose={handleClose}
        onCreate={() => setShowProviderMenu(true)}
      />

      {/* Provider selection popover */}
      {showProviderMenu && (
        <div
          ref={providerMenuRef}
          className="absolute top-8 right-1 z-20 rounded-lg border border-border shadow-lg py-1 min-w-[180px]"
          style={{ background: "var(--bg-elevated)" }}
        >
          {AI_PROVIDERS.map((p) => {
            const hasKey = p.id === "claude-code" || !!(apiKeys[p.id] ?? "").trim();
            const models = p.id !== "claude-code" ? AI_MODELS[p.id as APIProvider] : [];
            const defaultModel = models.length > 0 ? models[0].id : undefined;
            return (
              <button
                key={p.id}
                onClick={() => handleCreate(p.id, defaultModel)}
                disabled={creating || !hasKey}
                className="w-full text-left px-3 py-1.5 text-ui hover:bg-bg-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between"
              >
                <span className="text-text-primary">{p.label}</span>
                {!hasKey && (
                  <span className="text-[9px] text-text-ghost">No key</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Capability indicator for API providers */}
      {isApiProvider && messages.length === 0 && !streaming?.isStreaming && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-text-ghost border-b border-border-light" style={{ background: "var(--bg-secondary)" }}>
          <Info size={10} />
          <span>Chat only — no file access or tool use. Uses your {activeInstance.provider} API key.</span>
        </div>
      )}

      {/* Messages area */}
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
        <div className="p-2 flex gap-2 items-end relative">
          {/* Slash command palette */}
          {showCommandPalette && isClaudeCode && filteredCommands.length > 0 && (
            <div
              ref={commandPaletteRef}
              className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border border-border shadow-lg overflow-hidden z-10"
              style={{ background: "var(--bg-elevated)", maxHeight: 240 }}
            >
              <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={`${cmd.category}-${cmd.name}`}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                      i === commandIndex ? "bg-bg-subtle" : "hover:bg-bg-subtle/50"
                    }`}
                    onClick={() => {
                      setShowCommandPalette(false);
                      setInput("");
                      handleSlashCommand("/" + cmd.name);
                    }}
                    onMouseEnter={() => setCommandIndex(i)}
                  >
                    <span className="font-mono text-label text-accent shrink-0">/{cmd.name}</span>
                    <span className="text-label text-text-dim truncate flex-1">{cmd.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isClaudeCode ? "Ask the assistant... (/ for commands)" : "Ask the assistant..."}
            disabled={!activeAssistantId || busy}
            rows={4}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-chat text-text-primary placeholder-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-light)",
              minHeight: 96,
              maxHeight: 200,
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
