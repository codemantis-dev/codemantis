/**
 * Integration test: Codex "Recover session" flow (recoverCodexSession).
 *
 * Exercises the real useClaudeSession hook + real Zustand stores + real recap
 * helpers. Only the Tauri IPC boundary and toast/error sinks are mocked.
 *
 * Covers: LLM recap, local recap fallback on NO_API_KEY, fresh-thread reset,
 * pending-recap prefix stored + consumed once on the next send, and the
 * full-restart fallback when the app-server is gone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetAllStores } from "../helpers/store-reset";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Session } from "../../types/session";

let sessionCounter = 0;

vi.mock("../../lib/tauri-commands", () => ({
  createSession: vi.fn(async (projectPath: string, name?: string) => {
    sessionCounter++;
    return {
      id: `session-${sessionCounter}`,
      name: name ?? `Session ${sessionCounter}`,
      project_path: projectPath,
      status: "connected",
      created_at: new Date().toISOString(),
      model: "gpt-5.5",
      icon_index: 0,
      agent_id: "codex",
    } satisfies Session;
  }),
  closeSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn().mockResolvedValue(undefined),
  listenChatEvents: vi.fn().mockResolvedValue(() => {}),
  listenActivityEvents: vi.fn().mockResolvedValue(() => {}),
  initializeSession: vi.fn().mockResolvedValue(undefined),
  saveSessionMessages: vi.fn().mockResolvedValue(undefined),
  loadSessionMessages: vi.fn().mockResolvedValue([]),
  closeTerminal: vi.fn().mockResolvedValue(undefined),
  resetCodexThread: vi.fn().mockResolvedValue("thr_new"),
  summarizeConversationForRecap: vi.fn().mockResolvedValue("LLM RECAP"),
  RESET_THREAD_NO_LIVE_PROCESS: "NO_LIVE_PROCESS",
}));

vi.mock("../../stores/toastStore", () => ({
  showToast: vi.fn(),
  useToastStore: {
    getState: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../lib/event-classifier", () => ({
  handleChatEvent: vi.fn(),
  handleActivityEvent: vi.fn(),
  startStaleDetection: vi.fn(),
  cleanupSession: vi.fn(),
}));

vi.mock("../../lib/error-handler", () => ({ handleError: vi.fn() }));
vi.mock("../../lib/error-messages", () => ({
  translateErrorForToast: vi.fn((msg: string) => msg),
}));

import {
  sendMessage as sendMessageCmd,
  resetCodexThread,
  summarizeConversationForRecap,
  createSession,
} from "../../lib/tauri-commands";
import { useClaudeSession } from "../../hooks/useClaudeSession";

const PROJECT_PATH = "/tmp/test-project";
const SESSION_ID = "codex-1";

function setupSettings(): void {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      defaultContextWindow: 200000,
      defaultThinkingEffort: null,
      defaultAgentByTask: {},
    } as ReturnType<typeof useSettingsStore.getState>["settings"],
    loaded: true,
  });
}

function seedCodexSession(): void {
  const store = useSessionStore.getState();
  store.addSession({
    id: SESSION_ID,
    name: "Codex",
    project_path: PROJECT_PATH,
    status: "connected",
    created_at: new Date().toISOString(),
    model: "gpt-5.5",
    icon_index: 0,
    agent_id: "codex",
  });
  store.addMessage(SESSION_ID, {
    id: "u1", role: "user", content: "refactor the parser", timestamp: "", activityIds: [], isStreaming: false,
  });
  store.addMessage(SESSION_ID, {
    id: "a1", role: "assistant", content: "I split it into tokens", timestamp: "", activityIds: [], isStreaming: false,
  });
}

describe("recoverCodexSession (Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
    setupSettings();
    sessionCounter = 0;
    vi.mocked(resetCodexThread).mockResolvedValue("thr_new");
    vi.mocked(summarizeConversationForRecap).mockResolvedValue("LLM RECAP");
  });

  it("uses the LLM recap, resets the thread, stores the prefix, and notes it in chat", async () => {
    seedCodexSession();
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.recoverCodexSession(SESSION_ID);
    });

    expect(resetCodexThread).toHaveBeenCalledWith(SESSION_ID);
    expect(useSessionStore.getState().pendingRecapPrefix.get(SESSION_ID)).toBe("LLM RECAP");
    expect(useSessionStore.getState().sessionBusy.get(SESSION_ID)).toBe(false);
    const messages = useSessionStore.getState().sessionMessages.get(SESSION_ID) ?? [];
    expect(messages[messages.length - 1].content).toContain("Started a fresh Codex thread");
  });

  it("falls back to a local recap when no API key is configured", async () => {
    seedCodexSession();
    vi.mocked(summarizeConversationForRecap).mockRejectedValueOnce("NO_API_KEY");
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.recoverCodexSession(SESSION_ID);
    });

    expect(resetCodexThread).toHaveBeenCalledWith(SESSION_ID);
    const prefix = useSessionStore.getState().pendingRecapPrefix.get(SESSION_ID);
    // Local fallback quotes the recent turns verbatim.
    expect(prefix).toContain("Recap of the prior conversation");
    expect(prefix).toContain("refactor the parser");
  });

  it("consumes the recap prefix once on the next send, then clears it", async () => {
    seedCodexSession();
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.recoverCodexSession(SESSION_ID);
    });
    await act(async () => {
      await result.current.sendMessage(SESSION_ID, "continue please");
    });

    // The CLI payload carries the recap prefix + the user prompt.
    const firstCall = vi.mocked(sendMessageCmd).mock.calls[0];
    expect(firstCall[0]).toBe(SESSION_ID);
    expect(firstCall[1]).toContain("LLM RECAP");
    expect(firstCall[1]).toContain("continue please");
    // Prefix is cleared so it isn't re-applied on the following turn.
    expect(useSessionStore.getState().pendingRecapPrefix.has(SESSION_ID)).toBe(false);

    await act(async () => {
      await result.current.sendMessage(SESSION_ID, "next");
    });
    const secondCall = vi.mocked(sendMessageCmd).mock.calls[1];
    expect(secondCall[1]).toBe("next");
    expect(secondCall[1]).not.toContain("LLM RECAP");
  });

  it("falls back to a full restart when the app-server is gone", async () => {
    seedCodexSession();
    vi.mocked(resetCodexThread).mockRejectedValueOnce("Error: NO_LIVE_PROCESS");
    const { result } = renderHook(() => useClaudeSession());

    await act(async () => {
      await result.current.recoverCodexSession(SESSION_ID);
    });

    // A fresh session was spawned under the same agent…
    expect(createSession).toHaveBeenCalled();
    // …and no recap prefix was stored (the in-process recap can't carry over).
    expect(useSessionStore.getState().pendingRecapPrefix.has(SESSION_ID)).toBe(false);
  });
});
