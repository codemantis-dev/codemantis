import { useState, useCallback } from "react";
import type { SlashCommand } from "../types/slash-commands";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useClaudeSession } from "./useClaudeSession";
import {
  expandSkill,
  pauseSessionProcess,
  resumeSessionProcess,
  sendMessage as sendMessageCmd,
} from "../lib/tauri-commands";
import { showToast } from "../stores/toastStore";

export function useCommandExecution(): {
  executeCommand: (command: SlashCommand, args: string) => Promise<void>;
  isExecuting: boolean;
} {
  const [isExecuting, setIsExecuting] = useState(false);
  const { sendMessage, closeSession, renameSession } = useClaudeSession();

  const executeCommand = useCallback(
    async (command: SlashCommand, args: string) => {
      const sessionStore = useSessionStore.getState();
      const activeSessionId = sessionStore.activeSessionId;
      if (!activeSessionId) {
        showToast("No active session", "error");
        return;
      }

      const session = sessionStore.sessions.get(activeSessionId);
      if (!session) {
        showToast("Session not found", "error");
        return;
      }

      // Prevent execution while streaming
      const streaming = sessionStore.sessionStreaming.get(activeSessionId);
      if (streaming?.isStreaming) {
        showToast("Wait for the current response to finish", "info");
        return;
      }

      setIsExecuting(true);

      try {
        switch (command.category) {
          case "skill":
            await executeSkill(command, args, session, activeSessionId);
            break;
          case "built-in":
            await executeBuiltin(command, args, activeSessionId);
            break;
          case "cli-only":
            executeCliOnly(command, args);
            break;
        }
      } catch (e) {
        console.error(`[command] Failed to execute /${command.name}:`, e);
        showToast(`Command failed: ${String(e)}`, "error");
      } finally {
        setIsExecuting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- executeBuiltin and executeSkill are stable inner functions that only use sendMessage/closeSession/renameSession
    [sendMessage, closeSession, renameSession]
  );

  async function executeSkill(
    command: SlashCommand,
    args: string,
    session: { project_path: string; cli_session_id?: string | null },
    sessionId: string
  ): Promise<void> {
    if (!command.source_path) {
      showToast("Skill source file not found", "error");
      return;
    }

    const expanded = await expandSkill(
      session.project_path,
      command.source_path,
      args,
      session.cli_session_id ?? ""
    );

    if (!expanded.prompt.trim()) {
      showToast("Skill expanded to empty prompt", "error");
      return;
    }

    await sendMessage(sessionId, expanded.prompt);
  }

  async function executeBuiltin(
    command: SlashCommand,
    args: string,
    sessionId: string
  ): Promise<void> {
    switch (command.name) {
      case "clear": {
        useSessionStore.getState().clearSessionData(sessionId);
        try {
          await pauseSessionProcess(sessionId);
          await resumeSessionProcess(sessionId);
        } catch (e) {
          console.error("[command] Failed to restart session:", e);
          showToast("Failed to restart session process", "error");
        }
        showToast("Session cleared", "success");
        break;
      }

      case "help":
        addSystemMessage(sessionId, formatHelpMessage());
        break;

      case "context": {
        const ctx = useSessionStore.getState().sessionContext.get(sessionId);
        if (ctx) {
          const pct = Math.round((ctx.used / ctx.max) * 100);
          addSystemMessage(
            sessionId,
            `**Context usage:** ${ctx.used.toLocaleString()} / ${ctx.max.toLocaleString()} tokens (${pct}%)`
          );
        } else {
          addSystemMessage(sessionId, "Context information not available yet.");
        }
        break;
      }

      case "cost": {
        const stats = useSessionStore.getState().sessionStats.get(sessionId);
        if (stats) {
          const lines = [
            `**Session cost:** $${stats.totalCostUsd.toFixed(4)}`,
            `**Turns:** ${stats.turnCount}`,
            `**Input tokens:** ${stats.totalInputTokens.toLocaleString()}`,
            `**Output tokens:** ${stats.totalOutputTokens.toLocaleString()}`,
          ];
          if (stats.totalCacheReadTokens) {
            lines.push(`**Cache read:** ${stats.totalCacheReadTokens.toLocaleString()}`);
          }
          if (stats.totalCacheCreationTokens) {
            lines.push(`**Cache creation:** ${stats.totalCacheCreationTokens.toLocaleString()}`);
          }
          addSystemMessage(sessionId, lines.join("\n"));
        } else {
          addSystemMessage(sessionId, "Cost information not available yet.");
        }
        break;
      }

      case "compact": {
        addSystemMessage(sessionId, "Compacting conversation context...");
        try {
          await sendMessageCmd(sessionId, "/compact");
        } catch (e) {
          console.error("[command] Failed to compact:", e);
          showToast("Failed to compact conversation", "error");
        }
        break;
      }

      case "exit":
        await closeSession(sessionId);
        break;

      case "rename": {
        const newName = args.trim();
        if (!newName) {
          showToast("Usage: /rename <new name>", "info");
          return;
        }
        await renameSession(sessionId, newName);
        showToast(`Session renamed to "${newName}"`, "success");
        break;
      }

      default:
        showToast(`Built-in command /${command.name} not implemented`, "info");
    }
  }

  function executeCliOnly(command: SlashCommand, args: string): void {
    const fullInput = "/" + command.name + (args ? " " + args : "");
    useUiStore.getState().setCliOverlayInitialInput(fullInput);
    useUiStore.getState().setShowCliOverlay(true);
  }

  return { executeCommand, isExecuting };
}

function addSystemMessage(sessionId: string, content: string): void {
  useSessionStore.getState().addMessage(sessionId, {
    id: `system-${Date.now()}`,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    activityIds: [],
    isStreaming: false,
  });
}

function formatHelpMessage(): string {
  return [
    "**CodeMantis Commands**",
    "",
    "**Skills** — Custom commands from `.claude/commands/` expand into prompts",
    "",
    "**Built-in** (instant, no process restart):",
    "- `/clear` — Clear conversation and restart",
    "- `/compact` — Compact conversation context",
    "- `/context` — Show context window usage",
    "- `/cost` — Show session cost and stats",
    "- `/exit` — Close current session",
    "- `/help` — Show this help",
    "- `/rename <name>` — Rename session",
    "",
    "**Opens CLI** (interactive terminal):",
    "- `/config`, `/doctor`, `/model`, `/mcp`, `/hooks`, `/theme`, etc.",
    "",
    "**Tip:** Press `Cmd+/` to open the command palette.",
  ].join("\n");
}
