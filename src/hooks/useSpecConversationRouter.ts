import { useCallback } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSpecConversation } from "./useSpecConversation";
import { useSpecConversationClaude } from "./useSpecConversationClaude";
import type { SpecAttachment } from "../types/spec-writer";

/**
 * Routing hook that delegates SpecWriter operations to the correct backend:
 * - "claude-code" provider → useSpecConversationClaude (CLI session)
 * - Any other provider → useSpecConversation (API call)
 */
export function useSpecConversationRouter(): {
  sendMessage: (
    projectPath: string,
    content: string,
    attachments?: SpecAttachment[]
  ) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  generateAudit: (projectPath: string) => void;
  loadContext: (projectPath: string) => Promise<void>;
  cancelStream: (projectPath: string) => void;
} {
  const api = useSpecConversation();
  const cli = useSpecConversationClaude();

  const isClaudeCode = useCallback((projectPath: string): boolean => {
    const conv = useSpecWriterStore.getState().getActiveConversation(projectPath);
    return conv?.ai_provider === "claude-code";
  }, []);

  const sendMessage = useCallback(
    async (
      projectPath: string,
      content: string,
      attachments?: SpecAttachment[]
    ) => {
      if (isClaudeCode(projectPath)) {
        await cli.sendMessage(projectPath, content, attachments);
      } else {
        await api.sendMessage(projectPath, content, attachments);
      }
    },
    [api, cli, isClaudeCode]
  );

  const writeSpec = useCallback(
    (projectPath: string) => {
      if (isClaudeCode(projectPath)) {
        cli.writeSpec(projectPath);
      } else {
        api.writeSpec(projectPath);
      }
    },
    [api, cli, isClaudeCode]
  );

  const generateAudit = useCallback(
    (projectPath: string) => {
      if (isClaudeCode(projectPath)) {
        cli.generateAudit(projectPath);
      } else {
        api.generateAudit(projectPath);
      }
    },
    [api, cli, isClaudeCode]
  );

  const loadContext = useCallback(
    async (projectPath: string) => {
      // Both paths use the same loadContext implementation
      if (isClaudeCode(projectPath)) {
        await cli.loadContext(projectPath);
      } else {
        await api.loadContext(projectPath);
      }
    },
    [api, cli, isClaudeCode]
  );

  const cancelStream = useCallback(
    (projectPath: string) => {
      if (isClaudeCode(projectPath)) {
        cli.cancelStream(projectPath);
      } else {
        api.cancelStream(projectPath);
      }
    },
    [api, cli, isClaudeCode]
  );

  return {
    sendMessage,
    writeSpec,
    generateAudit,
    loadContext,
    cancelStream,
  };
}
