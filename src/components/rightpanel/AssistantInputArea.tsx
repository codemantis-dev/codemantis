import { useState, useCallback, useMemo, useEffect } from "react";
import { Send, Plus, Square } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { shouldSend } from "../../lib/keyboard";
import type { SlashCommand } from "../../types/slash-commands";
import type { Attachment } from "../../types/attachment";
import type { AssistantShortcut } from "../../types/settings";
import AssistantAttachmentBar from "./AssistantAttachmentBar";
import AssistantCommandPalette from "./AssistantCommandPalette";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useAssistantStore } from "../../stores/assistantStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import {
  discoverCommands,
  expandSkill,
  pauseSessionProcess,
  resumeSessionProcess,
} from "../../lib/tauri-commands";
import { assistantInputDrafts } from "../../lib/input-drafts";

interface AssistantInputAreaProps {
  activeAssistantId: string | null;
  activeProjectPath: string | null;
  busy: boolean;
  isClaudeCode: boolean;
  currentAttachments: Attachment[];
  removeAssistantAttachment: (sessionId: string, attachmentId: string) => void;
  clearAssistantAttachments: (sessionId: string) => void;
  sendMessage: (sessionId: string, prompt: string, attachments?: Attachment[]) => void;
  cancelAssistant: (sessionId: string) => void;
  closeAssistant: (projectPath: string, sessionId: string) => Promise<void>;
  shortcuts: AssistantShortcut[];
  inputContainerRef: React.RefObject<HTMLDivElement | null>;
  dragOver: boolean;
  handlePaste: (e: React.ClipboardEvent) => Promise<void>;
  handleFileDialog: () => Promise<void>;
  onInputChange: (value: string) => void;
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function AssistantInputArea({
  activeAssistantId,
  activeProjectPath,
  busy,
  isClaudeCode,
  currentAttachments,
  removeAssistantAttachment,
  clearAssistantAttachments,
  sendMessage,
  cancelAssistant,
  closeAssistant,
  shortcuts,
  inputContainerRef,
  dragOver,
  handlePaste,
  handleFileDialog,
  onInputChange,
  input,
  textareaRef,
}: AssistantInputAreaProps) {
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);

  const sendShortcut = useSettingsStore((s) => s.settings.sendShortcut);
  const closeCommandPalette = useCallback(() => setShowCommandPalette(false), []);
  const commandPaletteRef = useClickOutside<HTMLDivElement>(showCommandPalette, closeCommandPalette);

  useEffect(() => {
    if (!activeProjectPath) return;
    discoverCommands(activeProjectPath)
      .then(setCommands)
      .catch((e) => console.error("[assistant] Failed to discover commands:", e));
  }, [activeProjectPath]);

  const handleClose = useCallback(async (sessionId: string) => {
    if (!activeProjectPath) return;
    await closeAssistant(activeProjectPath, sessionId);
  }, [activeProjectPath, closeAssistant]);

  const handleSlashCommand = useCallback(async (rawInput: string) => {
    if (!activeAssistantId || !activeProjectPath) return;

    const withoutSlash = rawInput.slice(1);
    const [cmdName, ...argParts] = withoutSlash.split(/\s+/);
    const args = argParts.join(" ");

    const cmd = commands.find((c) => c.name.toLowerCase() === cmdName.toLowerCase());
    if (!cmd) {
      const store = useAssistantStore.getState();
      store.addMessage(activeAssistantId, {
        id: `sys-${Date.now()}`,
        role: "assistant",
        content: `Unknown command \`/${cmdName}\`. Type \`/\` to see available commands.`,
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
      });
      onInputChange("");
      return;
    }

    onInputChange("");
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
          case "clear": {
            store.clearMessages(activeAssistantId);
            try {
              await pauseSessionProcess(activeAssistantId);
              await resumeSessionProcess(activeAssistantId);
            } catch {
              // Non-fatal: session may be API-only or already closed
            }
            break;
          }
          case "context": {
            const sessionCtx = useSessionStore.getState().sessionContext.get(activeAssistantId);
            if (sessionCtx) {
              const pct = sessionCtx.max > 0 ? Math.round((sessionCtx.used / sessionCtx.max) * 100) : 0;
              sysMsg(`**Context:** ${sessionCtx.used.toLocaleString()} / ${sessionCtx.max.toLocaleString()} tokens (${pct}%)`);
            } else {
              sysMsg("Context info is not available for this assistant type.");
            }
            break;
          }
          case "cost": {
            const usage = store.getTokenUsage(activeAssistantId);
            const stats = useSessionStore.getState().sessionStats.get(activeAssistantId);
            if (stats) {
              sysMsg(`**Session Cost**\n- Cost: $${stats.totalCostUsd.toFixed(4)}\n- Input: ${stats.totalInputTokens.toLocaleString()} tokens\n- Output: ${stats.totalOutputTokens.toLocaleString()} tokens\n- Turns: ${stats.turnCount}`);
            } else if (usage.inputTokens > 0 || usage.outputTokens > 0) {
              sysMsg(`**Token Usage**\n- Input: ${usage.inputTokens.toLocaleString()} tokens\n- Output: ${usage.outputTokens.toLocaleString()} tokens`);
            } else {
              sysMsg("No usage data available yet.");
            }
            break;
          }
          case "exit":
            handleClose(activeAssistantId);
            break;
          case "rename": {
            if (args.trim()) {
              store.renameAssistant(activeProjectPath, activeAssistantId, args.trim());
              sysMsg(`Renamed to **${args.trim()}**`);
            } else {
              sysMsg("Usage: `/rename New Name`");
            }
            break;
          }
          default:
            sysMsg(`The \`/${cmd.name}\` command is not available in assistant tabs.`);
            break;
        }
      } else {
        if (isClaudeCode && activeProjectPath) {
          useUiStore.getState().setCliOverlayInitialInput(rawInput);
          useUiStore.getState().setCliOverlaySessionId(activeAssistantId);
          useUiStore.getState().setCliOverlayProjectPath(activeProjectPath);
          useUiStore.getState().setShowCliOverlay(true);
        } else {
          const store = useAssistantStore.getState();
          store.addMessage(activeAssistantId, {
            id: `sys-${Date.now()}`,
            role: "assistant",
            content: `The \`/${cmd.name}\` command requires the Claude Code CLI and is not available for API providers.`,
            timestamp: new Date().toISOString(),
            activityIds: [],
            isStreaming: false,
          });
        }
      }
    } catch (e) {
      console.error("[assistant] Slash command error:", e);
    }
  }, [activeAssistantId, activeProjectPath, commands, sendMessage, handleClose, isClaudeCode, onInputChange, textareaRef]);

  const filteredCommands = useMemo((): SlashCommand[] => {
    if (!commandQuery) return commands;
    const q = commandQuery.toLowerCase().split(/\s/)[0];
    return commands.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [commands, commandQuery]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    const hasAttachments = currentAttachments.length > 0;
    if ((!trimmed && !hasAttachments) || !activeAssistantId || busy) return;

    if (isClaudeCode && trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      return;
    }

    sendMessage(activeAssistantId, trimmed, hasAttachments ? currentAttachments : undefined);
    clearAssistantAttachments(activeAssistantId);
    onInputChange("");
    assistantInputDrafts.delete(activeAssistantId);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSlashCommand is defined above and uses callbacks that would create a circular dependency
  }, [input, activeAssistantId, busy, sendMessage, isClaudeCode, currentAttachments, clearAssistantAttachments, onInputChange, textareaRef]);

  const handleStop = useCallback(() => {
    if (!activeAssistantId || !busy) return;
    cancelAssistant(activeAssistantId);
  }, [activeAssistantId, busy, cancelAssistant]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showCommandPalette) {
        const filtered = filteredCommands;
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
              onInputChange("");
              if (textareaRef.current) textareaRef.current.style.height = "auto";
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
            onInputChange("");
            return;
        }
      }

      if (shouldSend(e, sendShortcut)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showCommandPalette, commandIndex, commandQuery, activeProjectPath, activeAssistantId, sendMessage, handleSlashCommand, filteredCommands, onInputChange, textareaRef, sendShortcut]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      onInputChange(value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";

      if (isClaudeCode && value.startsWith("/")) {
        const query = value.slice(1);
        setCommandQuery(query);
        setShowCommandPalette(true);
        setCommandIndex(0);
      } else {
        setShowCommandPalette(false);
      }
    },
    [isClaudeCode, onInputChange]
  );

  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    setShowCommandPalette(false);
    onInputChange("");
    handleSlashCommand("/" + cmd.name);
  }, [handleSlashCommand, onInputChange]);

  return (
    <div
      ref={inputContainerRef}
      className={`shrink-0 border-t relative ${dragOver ? "bg-accent/5" : ""}`}
      style={{ borderColor: "var(--border-light)" }}
    >
      {showCommandPalette && isClaudeCode && filteredCommands.length > 0 && (
        <AssistantCommandPalette
          commands={filteredCommands}
          commandIndex={commandIndex}
          onSelect={handleCommandSelect}
          onHover={setCommandIndex}
          commandPaletteRef={commandPaletteRef}
        />
      )}
      {shortcuts.length > 0 && !showCommandPalette && (
        <div className="flex flex-wrap gap-1 px-2 pt-1.5">
          {shortcuts.map((sc) => (
            <button
              key={sc.id}
              onClick={() => onInputChange(sc.prompt)}
              className="px-2 py-0.5 rounded-full text-label text-text-dim hover:text-text-primary bg-bg-elevated hover:bg-accent/10 border border-border-light hover:border-accent/30 transition-colors"
              title={sc.prompt}
            >
              {sc.name}
            </button>
          ))}
        </div>
      )}
      {activeAssistantId && (
        <AssistantAttachmentBar
          attachments={currentAttachments}
          onRemove={(id) => removeAssistantAttachment(activeAssistantId, id)}
        />
      )}
      {dragOver && (
        <div className="px-4 py-2 text-center text-accent text-ui">
          Drop files to attach
        </div>
      )}
      <div className="p-2 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isClaudeCode ? "Ask the assistant... (/ for commands)" : "Ask the assistant..."}
          disabled={!activeAssistantId}
          rows={4}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-chat text-text-primary placeholder-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-light)",
            minHeight: 96,
            maxHeight: 200,
          }}
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={handleFileDialog}
            disabled={!activeAssistantId || busy}
            className="p-1.5 rounded-lg text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Attach file"
          >
            <Plus size={16} />
          </button>
          {busy ? (
            <button
              onClick={handleStop}
              className="p-1.5 rounded-lg text-red hover:bg-red/10 transition-colors"
              title="Stop generation (Esc)"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && currentAttachments.length === 0) || !activeAssistantId}
              className="p-1.5 rounded-lg text-accent hover:bg-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={`Send (${sendShortcut === "enter" ? "Enter" : "Cmd+Enter"})`}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
