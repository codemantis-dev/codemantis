import { useCallback } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useAttachmentStore } from "../stores/attachmentStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useChangelogStore } from "../stores/changelogStore";
import { useAssistantStore } from "../stores/assistantStore";
import { getAssistantListeners } from "./useAssistantSession";
import {
  createSession,
  sendMessage as sendMessageCmd,
  closeSession as closeSessionCmd,
  renameSession as renameSessionCmd,
  listenChatEvents,
  listenActivityEvents,
  closeTerminal as closeTerminalCmd,
  initializeSession,
  saveSessionMessages,
  loadSessionMessages,
  resetCodexThread,
  summarizeConversationForRecap,
  RESET_THREAD_NO_LIVE_PROCESS,
  pauseSessionProcess,
  resumeSessionProcess,
} from "../lib/tauri-commands";
import { buildTranscriptText, buildLocalRecap } from "../lib/recap";
import { useSettingsStore } from "../stores/settingsStore";
import type { SessionMessagePayload, Message, Session, SessionHistoryEntry } from "../types/session";
import type { AgentId } from "../types/agent-events";
import { useUiStore } from "../stores/uiStore";
import {
  handleChatEvent,
  handleActivityEvent,
  startStaleDetection,
  cleanupSession,
} from "../lib/event-classifier";
import { showToast } from "../stores/toastStore";
import { handleError } from "../lib/error-handler";
import { translateErrorForToast } from "../lib/error-messages";
import { inputDrafts } from "../lib/input-drafts";
import { scheduleFlushTranscript } from "../lib/session-transcript";
import { resolveAgentForTaskNow } from "../lib/agent-resolver";

const MAX_SESSIONS = 10;

// Module-level listener map — persists across re-renders
const sessionListeners = new Map<string, UnlistenFn[]>();

/**
 * Re-attach the Codex "Recover session" affordance to a restored transcript.
 *
 * `Message.recoverable` is set live by `handleProcessError` but is NOT
 * persisted (saveSessionMessages only stores role/content/timestamp/thinking).
 * So a session restored or resumed while stuck on a failed Codex compaction
 * would render the dead-end card with no Recover button — the exact bug a user
 * hit after reopening such a session. Re-derive the flag on the trailing
 * compaction-failure card so the escape hatch survives a restore. The
 * "Context compaction failed" title is Codex-only (see error-messages.ts).
 */
function withRecoverableCompactionCard(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (
    last.role === "assistant" &&
    !last.recoverable &&
    !last.retryable &&
    last.content.includes("Context compaction failed")
  ) {
    const copy = messages.slice();
    // Retry (re-run the turn) is the primary, 1.6.0-faithful action; Recover
    // (revive) is the escalation. Both survive a resume.
    copy[copy.length - 1] = { ...last, retryable: true, recoverable: true };
    return copy;
  }
  return messages;
}

/** Map persisted messages back to Message[] for a restored session, marking
 * them `isRestored` and re-deriving the Recover affordance. */
function restoredMessagesFrom(stored: SessionMessagePayload[]): Message[] {
  const messages: Message[] = stored.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    timestamp: m.timestamp,
    activityIds: [],
    isStreaming: false,
    thinkingContent: m.thinkingContent ?? undefined,
    isRestored: true,
  }));
  return withRecoverableCompactionCard(messages);
}

interface UseClaudeSessionReturn {
  startSession: (projectPath: string, agentOverride?: AgentId) => Promise<string>;
  addSessionToProject: (projectPath?: string, agentOverride?: AgentId) => Promise<void>;
  sendMessage: (sessionId: string, prompt: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  closeAllSessionsInProject: (projectPath: string) => Promise<void>;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  resumeFromHistory: (projectPath: string, cliSessionId: string, originalName: string, originalSessionId?: string, preloadedMessages?: Message[], agentId?: AgentId) => Promise<string>;
  /**
   * Add a tab in 'paused-recovered' status from a crash-recovery entry.
   * Loads the stored transcript but does NOT spawn a CLI subprocess; the user
   * clicks Resume on the in-chat banner to attach via resumeRecoveredSession.
   */
  restorePausedSession: (entry: SessionHistoryEntry) => Promise<void>;
  /**
   * Wake-recovery: re-attach to a session whose CLI subprocess is still
   * alive in the Rust backend (because only the WKWebView renderer was
   * reloaded, not the whole Tauri process). Creates the frontend tab,
   * loads the stored transcript, and re-binds the session-keyed Tauri
   * event listeners so streaming events resume. No `--resume` spawn.
   */
  reattachLiveSession: (info: Session) => Promise<void>;
  /**
   * Resume a paused-recovered tab: spawn a fresh CLI via --resume, then
   * replace the placeholder tab in-place so its position is preserved.
   */
  resumeRecoveredSession: (pausedSessionId: string) => Promise<string | null>;
  /**
   * Primary Codex recovery: revive the SAME thread non-destructively (kill +
   * respawn the local app-server, resume the same thread from its rollout).
   * Full conversation/context preserved; fixes a wedged connection / lost
   * notification. Same tab.
   */
  reviveCodexSession: (sessionId: string) => Promise<void>;
  /**
   * Last-resort Codex recovery: start a fresh empty thread on the live
   * app-server and prime it with a recap (LLM summary, or local bounded-tail
   * fallback). Discards the live conversation — only offered after a revive
   * has failed to make the context compactable. Falls back to a full restart
   * if the app-server is gone.
   */
  freshThreadCodexSession: (sessionId: string) => Promise<void>;
}

export function useClaudeSession(): UseClaudeSessionReturn {
  const sessionStore = useSessionStore;
  const activityStore = useActivityStore;
  const terminalStore = useTerminalStore;
  const changelogStore = useChangelogStore;

  const startSession = useCallback(async (projectPath: string, agentOverride?: AgentId): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      showToast(`Maximum ${MAX_SESSIONS} sessions allowed`, "error");
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    // v1.5.0 Phase 1: route through the per-task resolver. With no
    // per-task override set, this is exactly `selectedAgentId` (the
    // global default) — so existing flows are unchanged. With a
    // "Main chat sessions → Codex" override, new main sessions spawn
    // on Codex.
    //
    // `agentOverride` short-circuits the resolver: restarting an existing
    // session must re-spawn the SAME agent it ran under (a Codex session
    // restarted as Claude would feed a Codex thread-id to the Claude CLI
    // and fail with "No conversation found with session ID").
    const agentId = agentOverride ?? resolveAgentForTaskNow("main_chat");
    const session = await createSession(projectPath, undefined, undefined, agentId);
    sessionStore.getState().addSession(session);

    // The CLI in stream-json mode does not echo the running effort back in
    // any event (verified against v2.1.126), so we record what we passed
    // via the `--effort` flag at spawn. This makes the badge reflect the
    // actual running session, not whatever the user later changes the
    // persisted default to. See memory project_cli_effort_runtime_constraints.md.
    const spawnEffort = useSettingsStore.getState().settings.defaultThinkingEffort;
    if (spawnEffort) {
      sessionStore.getState().setSessionEffort(session.id, spawnEffort);
    }

    // Register event listeners for this session
    const unlistenChat = await listenChatEvents(session.id, (event) =>
      handleChatEvent(session.id, event)
    );
    const unlistenActivity = await listenActivityEvents(session.id, (event) =>
      handleActivityEvent(session.id, event)
    );

    sessionListeners.set(session.id, [
      unlistenChat,
      unlistenActivity,
    ]);

    startStaleDetection(session.id);

    // Discover CLI capabilities (models, commands, account info)
    initializeSession(session.id).catch((e) => {
      console.error("Failed to discover session capabilities:", e);
      showToast("Failed to discover session capabilities", "error");
    });

    return session.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const addSessionToProject = useCallback(async (projectPath?: string, agentOverride?: AgentId) => {
    const state = sessionStore.getState();
    const targetPath = (typeof projectPath === "string" ? projectPath : undefined) ?? state.activeProjectPath;
    if (!targetPath) {
      showToast("No active project to add session to", "error");
      return;
    }
    try {
      await startSession(targetPath, agentOverride);
    } catch (e) {
      handleError("Failed to add session to project", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [startSession]);

  const sendMessage = useCallback(async (sessionId: string, prompt: string) => {
    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return;

    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStore.getState().addMessage(sessionId, {
      id: msgId,
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    // Eagerly persist the transcript so the user prompt survives a crash
    // before the next 60s snapshot tick. Debounced ~500ms inside the helper.
    scheduleFlushTranscript(sessionId);
    sessionStore.getState().setSessionBusy(sessionId, true);

    // After a Codex "Recover session" reset the fresh thread has no context.
    // Prepend the stored recap (once) to the CLI payload so continuity is
    // restored — the displayed user message stays unprefixed.
    const recapPrefix = sessionStore.getState().pendingRecapPrefix.get(sessionId);
    let cliPrompt = prompt;
    if (recapPrefix) {
      cliPrompt = `${recapPrefix}\n\n---\n\n${prompt}`;
      sessionStore.getState().clearRecapPrefix(sessionId);
    }

    try {
      await sendMessageCmd(sessionId, cliPrompt);
    } catch (e) {
      handleError("Failed to send message", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const closeSessionFn = useCallback(async (sessionId: string) => {
    // Save session messages if session logs enabled (before messages are cleared)
    const { sessionLogsEnabled } = useSettingsStore.getState().settings;
    const messages = sessionStore.getState().sessionMessages.get(sessionId) ?? [];
    console.info(
      `[closeSession] sessionId=${sessionId} sessionLogsEnabled=${sessionLogsEnabled} messageCount=${messages.length}` +
      (messages.length > 0 ? ` roles=[${messages.map((m) => m.role).join(",")}] contentLengths=[${messages.map((m) => m.content.length).join(",")}]` : "")
    );
    if (sessionLogsEnabled) {
      if (messages.length > 0) {
        const payloads: SessionMessagePayload[] = messages.map((m, i) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          thinkingContent: m.thinkingContent ?? null,
          sortOrder: i,
        }));
        console.info(`[closeSession] Saving ${payloads.length} messages for session ${sessionId}...`);
        try {
          await saveSessionMessages(sessionId, payloads);
          console.info(`[closeSession] Successfully saved ${payloads.length} messages for session ${sessionId}`);
        } catch (e) {
          console.error("[closeSession] Failed to save session messages:", e);
          showToast("Failed to save session messages", "error");
        }
      } else {
        console.warn(`[closeSession] No messages to save for session ${sessionId}`);
      }
    } else {
      console.warn(`[closeSession] Session logs disabled — skipping save for ${sessionId} (${messages.length} messages lost)`);
    }

    // Unlisten all event listeners for this session
    const listeners = sessionListeners.get(sessionId);
    if (listeners) {
      for (const unlisten of listeners) {
        unlisten();
      }
      sessionListeners.delete(sessionId);
    }

    cleanupSession(sessionId);

    // Close all terminals for this session
    const terminals = terminalStore.getState().getTerminals(sessionId);
    for (const terminal of terminals) {
      try {
        await closeTerminalCmd(terminal.id);
      } catch (e) {
        console.error("Failed to close terminal:", e);
        showToast("Failed to close terminal", "error");
      }
    }
    terminalStore.getState().clearSession(sessionId);

    try {
      await closeSessionCmd(sessionId);
    } catch (e) {
      handleError("Failed to close session", e);
    }

    sessionStore.getState().removeSession(sessionId);
    activityStore.getState().clearEntries(sessionId);
    useAttachmentStore.getState().clearSession(sessionId);
    changelogStore.getState().clearSession(sessionId);
    inputDrafts.delete(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store refs (sessionStore, activityStore, terminalStore, changelogStore) are stable Zustand singletons
  }, []);

  const closeAllSessionsInProject = useCallback(async (projectPath: string) => {
    const state = sessionStore.getState();
    const sessionIds = state.tabOrder.filter((id) => {
      const s = state.sessions.get(id);
      return s && s.project_path === projectPath;
    });
    for (const sessionId of sessionIds) {
      await closeSessionFn(sessionId);
    }

    // Also close all assistant sessions for this project
    const aStore = useAssistantStore.getState();
    const assistantSessionIds = aStore.getAllSessionIds(projectPath);
    for (const aSessionId of assistantSessionIds) {
      const listeners = getAssistantListeners().get(aSessionId);
      if (listeners) {
        for (const unlisten of listeners) {
          unlisten();
        }
        getAssistantListeners().delete(aSessionId);
      }
      try {
        await closeSessionCmd(aSessionId);
      } catch (e) {
        console.error("Failed to close assistant session:", e);
      }
    }
    aStore.clearProject(projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [closeSessionFn]);

  const switchSession = useCallback((sessionId: string) => {
    sessionStore.getState().setActiveSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const renameSessionFn = useCallback(async (sessionId: string, name: string) => {
    sessionStore.getState().renameSession(sessionId, name);
    try {
      await renameSessionCmd(sessionId, name);
    } catch (e) {
      handleError("Failed to rename session", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const resumeFromHistory = useCallback(async (
    projectPath: string,
    cliSessionId: string,
    originalName: string,
    originalSessionId?: string,
    preloadedMessages?: Message[],
    agentId?: AgentId,
  ): Promise<string> => {
    const state = sessionStore.getState();
    if (state.tabOrder.length >= MAX_SESSIONS) {
      showToast(`Maximum ${MAX_SESSIONS} sessions allowed`, "error");
      throw new Error(`Maximum ${MAX_SESSIONS} sessions allowed`);
    }

    try {
      // `agentId` MUST be threaded through: `cliSessionId` is an
      // agent-specific resume token (a Claude session id OR a Codex thread
      // id). Omitting it makes the Rust `create_session` default to
      // ClaudeCode, which then rejects a Codex thread-id with "No
      // conversation found with session ID". Resume must re-spawn the same
      // agent the session originally ran under.
      const session = await createSession(projectPath, originalName, cliSessionId, agentId);
      sessionStore.getState().addSession(session);

      const spawnEffort = useSettingsStore.getState().settings.defaultThinkingEffort;
      if (spawnEffort) {
        sessionStore.getState().setSessionEffort(session.id, spawnEffort);
      }

      // Populate messages synchronously right after addSession so the chat
      // renders with content on its very first paint — no empty flash.
      // Preloaded path is used by resumeRecoveredSession (we already have the
      // messages in memory from the paused-recovered tab); the DB-load path
      // is used by the Recent Sessions picker.
      if (preloadedMessages && preloadedMessages.length > 0) {
        const storeState = sessionStore.getState();
        const sessionMessages = new Map(storeState.sessionMessages);
        sessionMessages.set(
          session.id,
          withRecoverableCompactionCard(preloadedMessages.map((m) => ({ ...m, isRestored: true }))),
        );
        sessionStore.setState({ sessionMessages });
      } else if (originalSessionId) {
        try {
          const stored = await loadSessionMessages(originalSessionId);
          console.info(`[resumeFromHistory] Loaded ${stored.length} stored messages for ${originalSessionId} → new session ${session.id}`);
          if (stored.length > 0) {
            const restoredMessages = restoredMessagesFrom(stored);
            const storeState = sessionStore.getState();
            const sessionMessages = new Map(storeState.sessionMessages);
            sessionMessages.set(session.id, restoredMessages);
            sessionStore.setState({ sessionMessages });
          }
        } catch (e) {
          console.error("[resumeFromHistory] Failed to load stored messages:", e);
        }
      }

      const unlistenChat = await listenChatEvents(session.id, (event) =>
        handleChatEvent(session.id, event)
      );
      const unlistenActivity = await listenActivityEvents(session.id, (event) =>
        handleActivityEvent(session.id, event)
      );

      sessionListeners.set(session.id, [unlistenChat, unlistenActivity]);

      startStaleDetection(session.id);

      initializeSession(session.id).catch((e) =>
        console.error("Failed to discover session capabilities:", e)
      );

      useUiStore.getState().setShowClaudeHistory(false);

      return session.id;
    } catch (e) {
      showToast(translateErrorForToast(String(e)), "error");
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const restorePausedSession = useCallback(async (entry: SessionHistoryEntry): Promise<void> => {
    const state = sessionStore.getState();
    if (state.sessions.has(entry.session_id)) {
      // Already restored — possibly a duplicate startup pass
      return;
    }
    console.info(
      `[restorePausedSession] entry session_id=${entry.session_id} name=${JSON.stringify(entry.name)} project_path=${JSON.stringify(entry.project_path)} cli_session_id=${entry.cli_session_id}`
    );
    const restored: Session = {
      id: entry.session_id,
      name: entry.name,
      project_path: entry.project_path,
      status: "paused-recovered",
      created_at: entry.closed_at,
      model: entry.model,
      icon_index: entry.icon_index,
      cli_session_id: entry.cli_session_id,
      agent_id: entry.agent_id,
    };
    sessionStore.getState().addSession(restored);

    try {
      const stored = await loadSessionMessages(entry.session_id);
      if (stored.length > 0) {
        const restoredMessages = restoredMessagesFrom(stored);
        const sessionMessages = new Map(sessionStore.getState().sessionMessages);
        sessionMessages.set(entry.session_id, restoredMessages);
        sessionStore.setState({ sessionMessages });
      }
    } catch (e) {
      console.error("[restorePausedSession] Failed to load stored messages:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const reattachLiveSession = useCallback(async (info: Session): Promise<void> => {
    const state = sessionStore.getState();
    if (state.sessions.has(info.id)) {
      // Already attached — second startup pass during the same boot. Idempotent.
      return;
    }
    console.info(
      `[reattachLiveSession] id=${info.id} name=${JSON.stringify(info.name)} project_path=${JSON.stringify(info.project_path)}`
    );
    // Take SessionInfo as-is from the backend. The status field is
    // whatever the backend currently reports — typically "connected" or
    // "idle". Crucially NOT "paused-recovered": there is a live CLI
    // subprocess on the other end and the chat surface should treat
    // this as a normal running tab.
    sessionStore.getState().addSession(info);

    // Mirror restorePausedSession's transcript hydration so the chat
    // paints with content on first render. The live CLI may also be
    // mid-stream — those events will arrive via the listeners below
    // and the existing stream handler appends to whatever is in the
    // store, so a stale autosave + a fresh streaming delta interleave
    // correctly.
    try {
      const stored = await loadSessionMessages(info.id);
      if (stored.length > 0) {
        const restoredMessages = restoredMessagesFrom(stored);
        const sessionMessages = new Map(sessionStore.getState().sessionMessages);
        sessionMessages.set(info.id, restoredMessages);
        sessionStore.setState({ sessionMessages });
      }
    } catch (e) {
      console.error("[reattachLiveSession] Failed to load stored messages:", e);
    }

    // Re-bind the session-keyed event listeners. The backend emits to
    // `claude-chat-<id>` / `codex-chat-<id>` regardless of whether
    // anyone is listening, so the events the live CLI is currently
    // producing land in the new listener as soon as it's installed —
    // no events are replayed (a brief gap is possible) but no events
    // are duplicated either.
    const unlistenChat = await listenChatEvents(info.id, (event) =>
      handleChatEvent(info.id, event)
    );
    const unlistenActivity = await listenActivityEvents(info.id, (event) =>
      handleActivityEvent(info.id, event)
    );
    sessionListeners.set(info.id, [unlistenChat, unlistenActivity]);

    startStaleDetection(info.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  const resumeRecoveredSession = useCallback(async (pausedSessionId: string): Promise<string | null> => {
    const state = sessionStore.getState();
    const session = state.sessions.get(pausedSessionId);
    if (!session || session.status !== "paused-recovered") return null;
    const cliSessionId = session.cli_session_id;
    if (!cliSessionId) {
      showToast("Cannot resume — no CLI session ID stored", "error");
      return null;
    }
    const oldIndex = state.tabOrder.indexOf(pausedSessionId);

    console.info(
      `[resumeRecoveredSession] paused session name=${JSON.stringify(session.name)} cli_session_id=${cliSessionId} project_path=${JSON.stringify(session.project_path)}`
    );

    // Capture the in-memory messages from the paused tab BEFORE we modify
    // the store. Passing them to resumeFromHistory lets the new session paint
    // with content immediately, eliminating the empty-flash users reported
    // when the old code did `removeSession → createSession → loadFromDB`.
    const pausedMessages = sessionStore.getState().sessionMessages.get(pausedSessionId) ?? [];

    // Tab-slot accounting: temporarily reserve the slot by NOT removing the
    // paused tab yet. If resumeFromHistory hits MAX_SESSIONS we'd refuse the
    // resume but leave the user without their tab. Instead, check capacity
    // here and rely on the fact that we'll remove the paused tab right after
    // the new one is in place.
    const tabCount = sessionStore.getState().tabOrder.length;
    if (tabCount >= MAX_SESSIONS) {
      // The paused tab itself occupies a slot, so removing it before resume
      // is the only way to stay under the cap. Accept the brief flash in
      // this edge case — it's the only path that doesn't drop the user's tab.
      sessionStore.getState().removeSession(pausedSessionId);
    }

    let newSessionId: string;
    try {
      newSessionId = await resumeFromHistory(
        session.project_path,
        cliSessionId,
        session.name,
        pausedSessionId,
        pausedMessages,
        session.agent_id,
      );
    } catch (e) {
      handleError("Failed to resume recovered session", e);
      return null;
    }

    // Atomic swap: the new tab is now in place WITH its messages. Remove the
    // paused placeholder. The user perceives a single transition rather than
    // empty-then-populated.
    if (sessionStore.getState().sessions.has(pausedSessionId)) {
      sessionStore.getState().removeSession(pausedSessionId);
    }

    if (oldIndex >= 0) {
      const order = sessionStore.getState().tabOrder.filter((id) => id !== newSessionId);
      order.splice(oldIndex, 0, newSessionId);
      sessionStore.getState().reorderTabs(order);
    }

    return newSessionId;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [resumeFromHistory]);

  // Primary recovery: revive the SAME Codex thread, non-destructively. Kill
  // the (possibly wedged) local app-server and respawn it resuming the same
  // thread — `resume_session_process` reloads the FULL conversation from the
  // thread's on-disk rollout, so no context is lost. We relaunch the local
  // process only because CodeMantis talks to `codex app-server` over a
  // stdin/stdout pipe and a wedged pipe can't be re-attached; the conversation
  // itself is unaffected. Reuses the proven pause+resume path the stuck-banner
  // already uses. Same tab, same listeners, full history.
  const reviveCodexSession = useCallback(async (sessionId: string): Promise<void> => {
    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return;
    try {
      await pauseSessionProcess(sessionId);
      await resumeSessionProcess(sessionId, session.cli_session_id ?? null);
    } catch (e) {
      handleError("Failed to recover session", e);
      return;
    }
    const store = sessionStore.getState();
    // Mark that a revive was tried: if the resumed thread still can't compact,
    // the next failure card escalates to "Start fresh thread" instead of
    // looping on revive. Cleared automatically on the next completed turn.
    store.setCodexRecoverAttempted(sessionId, true);
    store.setSessionBusy(sessionId, false);
    store.setSessionCompacting(sessionId, false);
    if (store.sessionStreaming.get(sessionId)?.isStreaming) {
      store.finalizeStreaming(sessionId);
    }
    store.addMessage(sessionId, {
      id: `revived-${Date.now()}`,
      role: "assistant",
      content:
        "**Reconnected to this Codex session.** The conversation and its full " +
        "context were reloaded — continue where you left off.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    showToast("Reconnected — Codex session revived", "info", 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, []);

  // Last-resort recovery: start a FRESH empty thread + recap. Only offered
  // after a revive has already failed to make the context compactable. This
  // discards the live conversation (the recap carries forward a summary).
  const freshThreadCodexSession = useCallback(async (sessionId: string): Promise<void> => {
    const session = sessionStore.getState().sessions.get(sessionId);
    if (!session) return;

    // 1. Build a recap of the conversation BEFORE resetting. Prefer the LLM
    // summary; fall back to a local bounded-tail recap when no API key is
    // configured (or the summary call fails for any reason).
    const messages = sessionStore.getState().sessionMessages.get(sessionId) ?? [];
    let recap: string;
    try {
      const transcript = buildTranscriptText(messages);
      recap = await summarizeConversationForRecap(sessionId, transcript);
    } catch (e) {
      // "NO_API_KEY" (expected when unconfigured) or any provider error →
      // local fallback. Both are non-fatal; recovery must still proceed.
      console.info("[freshThreadCodexSession] recap summary unavailable, using local fallback:", e);
      recap = buildLocalRecap(messages);
    }

    // 2. Reset to a fresh thread on the live app-server.
    try {
      await resetCodexThread(sessionId);
    } catch (e) {
      const msg = String(e);
      if (msg.includes(RESET_THREAD_NO_LIVE_PROCESS)) {
        // The app-server is gone — fall back to a full restart under the same
        // agent. (This drops the in-process recap, but a fresh session is the
        // only path left.)
        showToast("Codex process had ended — starting a fresh session", "info", 6000);
        try {
          await startSession(session.project_path, session.agent_id);
        } catch (restartErr) {
          handleError("Failed to start fresh thread", restartErr);
        }
        return;
      }
      handleError("Failed to start fresh thread", e);
      return;
    }

    // 3. Success: stash the recap for the next turn, clear stuck state, and
    // tell the user. The transcript above stays visible; the fresh thread
    // regains continuity on their next message.
    const store = sessionStore.getState();
    store.setRecapPrefix(sessionId, recap);
    store.setCodexRecoverAttempted(sessionId, false);
    store.setSessionBusy(sessionId, false);
    store.setSessionCompacting(sessionId, false);
    store.addMessage(sessionId, {
      id: `fresh-thread-${Date.now()}`,
      role: "assistant",
      content:
        "**Started a fresh Codex thread.** Your history above is preserved. " +
        "Your next message continues the work with a recap of the earlier conversation.",
      timestamp: new Date().toISOString(),
      activityIds: [],
      isStreaming: false,
    });
    showToast("Fresh Codex thread ready", "info", 6000);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionStore is a stable Zustand store reference
  }, [startSession]);

  return {
    startSession,
    addSessionToProject,
    sendMessage,
    closeSession: closeSessionFn,
    closeAllSessionsInProject,
    switchSession,
    renameSession: renameSessionFn,
    resumeFromHistory,
    restorePausedSession,
    reattachLiveSession,
    resumeRecoveredSession,
    reviveCodexSession,
    freshThreadCodexSession,
  };
}
