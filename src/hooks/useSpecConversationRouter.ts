import { useCallback } from "react";
import { useSpecWriterStore } from "../stores/specWriterStore";
import { useSpecConversation } from "./useSpecConversation";
import { useSpecConversationClaude } from "./useSpecConversationClaude";
import type { SpecAttachment } from "../types/spec-writer";

/**
 * Routing hook that delegates SpecWriter operations to the correct backend:
 * - "claude-code" / "codex" provider → useSpecConversationClaude (CLI session,
 *   despite the file name — it handles both local-CLI providers since
 *   v1.4.1 Phase B.1; the hook reads `conv.ai_provider` and passes the
 *   right `agent_id` to `createSpecwriterSession`)
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
  /** Stage 3: re-dispatch the latest audit recheck prompt. */
  requestRecheck: (projectPath: string) => boolean;
  /**
   * Recognize Guide (CLI path): send a recovery prompt into the live CLI
   * session and resolve with the model's raw reply. Only meaningful for
   * claude-code / codex providers (the caller branches on provider); API
   * providers recover via the `recover_session_plan` command instead.
   */
  recoverGuideViaCli: (projectPath: string, prompt: string) => Promise<string>;
} {
  const api = useSpecConversation();
  const cli = useSpecConversationClaude();

  // Predicate is named `isClaudeCode` for backwards compatibility but
  // actually means "is local-CLI provider" — both Claude Code and Codex
  // share the same hook (useSpecConversationClaude) since v1.4.1 Phase B.1.
  const isClaudeCode = useCallback((projectPath: string): boolean => {
    const conv = useSpecWriterStore.getState().getActiveConversation(projectPath);
    return conv?.ai_provider === "claude-code" || conv?.ai_provider === "codex";
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

  const requestRecheck = useCallback(
    (projectPath: string): boolean => {
      if (isClaudeCode(projectPath)) {
        return cli.requestRecheck(projectPath);
      }
      return api.requestRecheck(projectPath);
    },
    [api, cli, isClaudeCode]
  );

  // CLI-only — the in-band recovery lives on the Claude/Codex hook. The
  // actions layer only calls this when the provider is a local CLI.
  const recoverGuideViaCli = useCallback(
    (projectPath: string, prompt: string): Promise<string> =>
      cli.recoverGuideViaCli(projectPath, prompt),
    [cli],
  );

  return {
    sendMessage,
    writeSpec,
    generateAudit,
    loadContext,
    cancelStream,
    requestRecheck,
    recoverGuideViaCli,
  };
}
