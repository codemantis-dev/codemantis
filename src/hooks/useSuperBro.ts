import { useEffect, useRef, useCallback } from "react";
import { useSuperBroStore } from "../stores/superBroStore";
import { useSessionStore } from "../stores/sessionStore";
import { useActivityStore } from "../stores/activityStore";
import { useGuideStore } from "../stores/guideStore";
import { usePreviewStore } from "../stores/previewStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { SuperBroTrigger } from "../types/super-bro";
import {
  buildSuperBroContext,
  buildSuperBroRequest,
} from "../lib/super-bro-context";
import { parseSuperBroResponse } from "../lib/super-bro-parser";
import {
  sendAssistantChat,
  listenAssistantStream,
  readFileContent,
  getGitStatus,
} from "../lib/tauri-commands";

/** @visibleForTesting */
export const RATE_LIMIT_MS = 10_000; // 10 seconds between API calls

/** Per-trigger debounce: how long to wait for duplicate triggers to coalesce.
 *  @visibleForTesting */
export const DEBOUNCE_BY_TRIGGER: Record<SuperBroTrigger, number> = {
  claude_response:        500,   // store already filters for !isStreaming
  build_error:            1500,  // terminal output arrives in chunks
  test_failure:           1500,
  preview_error:          1500,  // console errors can cascade
  guide_session_start:    500,   // discrete event
  guide_session_complete: 500,
  session_start:          500,   // already has 2s pre-delay in useEffect
  silence_timeout:        0,     // single-fire by definition
  destructive_action:     0,     // urgent
};

const SILENCE_TIMEOUT_MS = 180_000; // 3 minutes
const MAX_FILE_CHECKS = 2;
const SUPER_BRO_ASSISTANT_ID = "__super-bro__";

// Error patterns to detect in terminal output
const BUILD_ERROR_PATTERNS = [
  /error TS\d+/i,
  /SyntaxError/,
  /ERROR in/,
  /Failed to compile/,
  /Build failed/,
  /ENOENT/,
  /Module not found/,
  /ModuleNotFoundError/,
  /ImportError/,
  /Traceback/,
  /error\[E\d+\]/,  // Rust errors
];

const TEST_FAILURE_PATTERNS = [
  /FAIL\s/,
  /Tests?:\s+\d+ failed/,
  /AssertionError/,
  /test.*failed/i,
  /FAILURES/,
  /Expected.*but received/,
];

/**
 * Resolve Super-Bro's AI provider and API key from settings.
 * Returns null if no suitable provider is available.
 */
function resolveSuperBroProvider(settings: ReturnType<typeof useSettingsStore.getState>["settings"]): {
  provider: string;
  model: string;
  apiKey: string;
} | null {
  const { superBroProvider, superBroModel, apiKeys } = settings;

  // If explicit provider/model set (not "auto"), use those
  if (superBroProvider !== "auto" && superBroModel !== "auto") {
    const key = apiKeys[superBroProvider]?.trim();
    if (!key) return null;
    return { provider: superBroProvider, model: superBroModel, apiKey: key };
  }

  // Auto-select: try providers in priority order (cheapest first)
  const priorityOrder: Array<{ provider: string; model: string }> = [
    { provider: "openrouter", model: "auto" },
    { provider: "gemini", model: "gemini-2.5-flash-lite" },
    { provider: "openai", model: "gpt-5.4-nano" },
    { provider: "anthropic", model: "claude-haiku-4-5" },
  ];

  for (const { provider, model } of priorityOrder) {
    const key = apiKeys[provider]?.trim();
    if (key) {
      const resolvedModel =
        provider === "openrouter" && model === "auto"
          ? "google/gemini-2.5-flash-preview-05-20:free"
          : model;
      return { provider, model: resolvedModel, apiKey: key };
    }
  }

  return null;
}

export function useSuperBro(projectPath: string | null): void {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastApiCallTime = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalBuffer = useRef("");
  const terminalEntries = useRef<string[]>([]);
  const pendingTrigger = useRef<SuperBroTrigger | null>(null);
  const fileCheckCount = useRef(0);
  const claudeMdCache = useRef<string | undefined>(undefined);
  const streamCleanup = useRef<(() => void) | null>(null);
  const prevMessageCount = useRef(0);
  const prevGuideSessionIndex = useRef<number | null>(null);
  const apiCallInFlight = useRef(false);

  // Read reactive values from stores
  const globalEnabled = useSettingsStore((s) => s.settings.superBroEnabled);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isPaused = useSuperBroStore((s) => s.isPaused);
  const enabledProjects = useSuperBroStore((s) => s.enabledProjects);
  const isEnabled = projectPath ? (enabledProjects.get(projectPath) ?? true) : false;

  // Keep refs in sync so timers/callbacks always read current values
  const projectPathRef = useRef(projectPath);
  projectPathRef.current = projectPath;
  const globalEnabledRef = useRef(globalEnabled);
  globalEnabledRef.current = globalEnabled;
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Reset local refs when switching sessions (not store state — that persists per-project)
  useEffect(() => {
    terminalBuffer.current = "";
    terminalEntries.current = [];
    prevMessageCount.current = 0;
    prevGuideSessionIndex.current = null;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (deferredRetryTimer.current) {
      clearTimeout(deferredRetryTimer.current);
      deferredRetryTimer.current = null;
    }
    pendingTrigger.current = null;
  }, [projectPath, activeSessionId]);

  // Load observations when project changes
  useEffect(() => {
    if (projectPath && globalEnabled && isEnabled) {
      useSuperBroStore.getState().loadObservations(projectPath);
    }
  }, [projectPath, globalEnabled, isEnabled]);

  // Load CLAUDE.md on project change
  useEffect(() => {
    if (!projectPath) return;
    claudeMdCache.current = undefined;
    readFileContent(`${projectPath}/CLAUDE.md`)
      .then((content) => {
        claudeMdCache.current = content;
      })
      .catch(() => {
        claudeMdCache.current = undefined;
      });
  }, [projectPath]);

  // ── Core API call logic (ref-based, no stale closures) ─────────────

  const executeSuperBroCall = useCallback(
    async (trigger: SuperBroTrigger) => {
      const pp = projectPathRef.current;
      if (!pp) return;
      if (apiCallInFlight.current) return;

      const settings = useSettingsStore.getState().settings;
      const resolved = resolveSuperBroProvider(settings);

      if (!resolved) {
        const store = useSuperBroStore.getState();
        const existingMsg = store.projectMessages.get(pp);
        if (!existingMsg) {
          store.setMessage(pp, {
            id: `sb-${Date.now()}`,
            guidance:
              "Configure an AI provider in Settings to enable Super-Bro guidance.",
            suggestedPrompt: null,
            fileCheckRequest: null,
            trigger: "session_start",
            timestamp: new Date().toISOString(),
            dismissed: false,
          });
        }
        return;
      }

      useSuperBroStore.getState().addLog("api_call", `Trigger: ${trigger} → ${resolved.provider}/${resolved.model}`);

      useSuperBroStore.getState().setThinking(pp, true);
      apiCallInFlight.current = true;
      lastApiCallTime.current = Date.now();
      fileCheckCount.current = 0;

      try {
        // Fetch live git status (non-blocking — falls back to defaults on error)
        let gitStatus: { changedFiles: number; uncommitted: boolean; branch: string } | undefined;
        try {
          const gs = await getGitStatus(pp);
          gitStatus = {
            changedFiles: gs.uncommitted_changes,
            uncommitted: gs.uncommitted_changes > 0,
            branch: gs.branch ?? "main",
          };
        } catch {
          // Git status unavailable — buildSuperBroContext uses safe defaults
        }

        const context = buildSuperBroContext(
          pp,
          terminalBuffer.current,
          gitStatus,
          claudeMdCache.current,
        );

        const observations = useSuperBroStore.getState().getObservations(pp);
        const { systemPrompt, userMessage } = await buildSuperBroRequest(
          trigger,
          context,
          observations,
        );

        const responseText = await callSuperBroApi(
          resolved.provider,
          resolved.apiKey,
          resolved.model,
          systemPrompt,
          userMessage,
        );

        useSuperBroStore.getState().addLog("response", `${responseText.length} chars: ${responseText.slice(0, 100)}`);

        const parsed = parseSuperBroResponse(responseText);

        if (parsed.isNothingToReport) {
          useSuperBroStore.getState().addLog("all_good", "NOTHING_TO_REPORT — all good");
          useSuperBroStore.getState().setAllGood(pp);
          return;
        }

        for (const obs of parsed.observations) {
          useSuperBroStore.getState().addObservation(pp, obs);
        }

        if (parsed.fileCheckRequest && fileCheckCount.current < MAX_FILE_CHECKS) {
          fileCheckCount.current++;
          useSuperBroStore.getState().addLog("api_call", `File check: ${parsed.fileCheckRequest}`);
          await handleFileCheck(
            resolved,
            systemPrompt,
            userMessage,
            responseText,
            parsed.fileCheckRequest,
            pp,
            trigger,
          );
          return;
        }

        useSuperBroStore.getState().addLog("response", `Guidance: ${parsed.guidance.slice(0, 80)}`);
        useSuperBroStore.getState().setMessage(pp, {
          id: `sb-${Date.now()}`,
          guidance: parsed.guidance,
          suggestedPrompt: parsed.suggestedPrompt,
          fileCheckRequest: parsed.fileCheckRequest,
          trigger,
          timestamp: new Date().toISOString(),
          dismissed: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useSuperBroStore.getState().addLog("error", `API call failed: ${msg}`);
        console.error("[Super-Bro] API call failed:", e);
        useSuperBroStore.getState().setThinking(pp, false);
      } finally {
        apiCallInFlight.current = false;
      }
    },
    [], // No deps — reads everything from refs and getState()
  );

  const handleFileCheck = useCallback(
    async (
      resolved: { provider: string; model: string; apiKey: string },
      systemPrompt: string,
      originalUserMessage: string,
      firstResponse: string,
      filePath: string,
      pp: string,
      trigger: SuperBroTrigger,
    ) => {
      try {
        const absolutePath = filePath.startsWith("/")
          ? filePath
          : `${pp}/${filePath}`;
        const fileContent = await readFileContent(absolutePath);

        const followUpMessage = `${originalUserMessage}\n\nYour previous response:\n${firstResponse}\n\nHere is the file you requested (${filePath}):\n\`\`\`\n${fileContent.slice(0, 3000)}\n\`\`\`\n\nNow give your final guidance based on what you see in the file.`;

        const responseText = await callSuperBroApi(
          resolved.provider,
          resolved.apiKey,
          resolved.model,
          systemPrompt,
          followUpMessage,
        );

        const parsed = parseSuperBroResponse(responseText);

        if (parsed.isNothingToReport) {
          useSuperBroStore.getState().setAllGood(pp);
          return;
        }

        for (const obs of parsed.observations) {
          useSuperBroStore.getState().addObservation(pp, obs);
        }

        if (parsed.fileCheckRequest && fileCheckCount.current < MAX_FILE_CHECKS) {
          fileCheckCount.current++;
          await handleFileCheck(
            resolved,
            systemPrompt,
            followUpMessage,
            responseText,
            parsed.fileCheckRequest,
            pp,
            trigger,
          );
          return;
        }

        useSuperBroStore.getState().setMessage(pp, {
          id: `sb-${Date.now()}`,
          guidance: parsed.guidance,
          suggestedPrompt: parsed.suggestedPrompt,
          fileCheckRequest: null,
          trigger,
          timestamp: new Date().toISOString(),
          dismissed: false,
        });
      } catch (e) {
        console.error("[Super-Bro] File check failed:", e);
        useSuperBroStore.getState().setThinking(pp, false);
      }
    },
    [],
  );

  const callSuperBroApi = useCallback(
    async (
      provider: string,
      apiKey: string,
      model: string,
      systemPrompt: string,
      userMessage: string,
    ): Promise<string> => {
      return new Promise(async (resolve, reject) => {
        let fullText = "";
        const timeout = setTimeout(() => {
          reject(new Error("Super-Bro API timeout (60s)"));
        }, 60000);

        if (streamCleanup.current) {
          streamCleanup.current();
          streamCleanup.current = null;
        }

        const unlisten = await listenAssistantStream(
          SUPER_BRO_ASSISTANT_ID,
          (event) => {
            if (event.type === "delta") {
              fullText += event.text;
            } else if (event.type === "done") {
              clearTimeout(timeout);
              resolve(event.content || fullText);
            } else if (event.type === "error") {
              clearTimeout(timeout);
              reject(new Error(event.message ?? "Super-Bro API error"));
            } else if (event.type === "cancelled") {
              clearTimeout(timeout);
              reject(new Error("Cancelled"));
            }
          },
        );

        streamCleanup.current = unlisten;

        try {
          await sendAssistantChat({
            assistantId: SUPER_BRO_ASSISTANT_ID,
            provider,
            apiKey,
            model,
            systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            maxTokens: 3000,
          });
        } catch (e) {
          clearTimeout(timeout);
          unlisten();
          streamCleanup.current = null;
          reject(e);
        }
      });
    },
    [],
  );

  // ── Trigger function (reads from refs, never stale) ────────────────

  const triggerSuperBro = useCallback(
    (trigger: SuperBroTrigger) => {
      if (!projectPathRef.current || !globalEnabledRef.current || !isEnabledRef.current || isPausedRef.current) {
        return;
      }

      useSuperBroStore.getState().addLog("trigger", `Event: ${trigger}`);

      pendingTrigger.current = trigger;

      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      const debounceMs = DEBOUNCE_BY_TRIGGER[trigger] ?? 500;

      debounceTimer.current = setTimeout(() => {
        const currentTrigger = pendingTrigger.current;
        if (!currentTrigger) return;
        pendingTrigger.current = null;

        // Re-check guards (values may have changed during debounce)
        if (!projectPathRef.current || !globalEnabledRef.current || !isEnabledRef.current || isPausedRef.current) {
          useSuperBroStore.getState().addLog("skip", "Skipped — disabled or paused");
          return;
        }

        // Rate limit check
        const now = Date.now();
        const elapsed = now - lastApiCallTime.current;
        if (elapsed < RATE_LIMIT_MS) {
          const retryIn = RATE_LIMIT_MS - elapsed;
          useSuperBroStore.getState().addLog(
            "skip",
            `Rate limited (${Math.round(retryIn / 1000)}s left) — scheduling deferred retry`,
          );

          // Schedule a deferred retry when the rate-limit window expires (keep only the latest)
          if (deferredRetryTimer.current) clearTimeout(deferredRetryTimer.current);
          deferredRetryTimer.current = setTimeout(() => {
            deferredRetryTimer.current = null;
            if (!projectPathRef.current || !globalEnabledRef.current || !isEnabledRef.current || isPausedRef.current) {
              return;
            }
            if (apiCallInFlight.current) return;
            useSuperBroStore.getState().addLog("trigger", `Deferred retry: ${currentTrigger}`);
            executeSuperBroCall(currentTrigger);
          }, retryIn + 100);

          return;
        }

        executeSuperBroCall(currentTrigger);
      }, debounceMs);
    },
    [executeSuperBroCall], // executeSuperBroCall has [] deps, so this is stable
  );

  // ── Subscriptions ──────────────────────────────────────────────────

  // Watch for new assistant messages (claude_response trigger)
  useEffect(() => {
    if (!activeSessionId || !globalEnabled || !isEnabled) return;

    // Initialize prevMessageCount to current count to avoid triggering on mount
    const initialMessages = useSessionStore.getState().sessionMessages.get(activeSessionId) ?? [];
    prevMessageCount.current = initialMessages.length;

    const unsub = useSessionStore.subscribe((state) => {
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      const messages = state.sessionMessages.get(sid) ?? [];
      const currentCount = messages.length;

      if (currentCount > prevMessageCount.current) {
        const lastMsg = messages[currentCount - 1];
        if (lastMsg?.role === "assistant" && !lastMsg.isStreaming) {
          triggerSuperBro("claude_response");
        }
      }
      prevMessageCount.current = currentCount;
    });

    return unsub;
  }, [activeSessionId, globalEnabled, isEnabled, triggerSuperBro]);

  // Watch for preview errors
  useEffect(() => {
    if (!projectPath || !globalEnabled || !isEnabled) return;

    const unsub = usePreviewStore.subscribe((state) => {
      const pp = projectPathRef.current;
      if (!pp) return;
      const errorCount = state.unreadErrors.get(pp) ?? 0;
      if (errorCount > 0) {
        triggerSuperBro("preview_error");
      }
    });

    return unsub;
  }, [projectPath, globalEnabled, isEnabled, triggerSuperBro]);

  // Watch for guide session transitions
  useEffect(() => {
    if (!globalEnabled || !isEnabled) return;

    const unsub = useGuideStore.subscribe((state) => {
      const guide = state.guide;
      if (!guide) return;

      const activeSession = guide.sessions.find((s) => s.status === "active");
      const activeIdx = activeSession?.index ?? null;

      if (prevGuideSessionIndex.current !== null && activeIdx !== null) {
        if (activeIdx > prevGuideSessionIndex.current) {
          triggerSuperBro("guide_session_start");
        }
      }

      if (prevGuideSessionIndex.current !== null && activeIdx === null) {
        const allDone = guide.sessions.every((s) => s.status === "done");
        if (allDone) {
          triggerSuperBro("guide_session_complete");
        }
      }

      prevGuideSessionIndex.current = activeIdx;
    });

    return unsub;
  }, [globalEnabled, isEnabled, triggerSuperBro]);

  // Silence timeout (user stuck > 3 min)
  useEffect(() => {
    if (!globalEnabled || !isEnabled || isPaused || !activeSessionId) {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      return;
    }

    const resetSilenceTimer = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        triggerSuperBro("silence_timeout");
      }, SILENCE_TIMEOUT_MS);
    };

    const unsub = useSessionStore.subscribe(() => {
      resetSilenceTimer();
    });

    resetSilenceTimer();

    return () => {
      unsub();
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
    };
  }, [globalEnabled, isEnabled, isPaused, activeSessionId, triggerSuperBro]);

  // Session start trigger
  useEffect(() => {
    if (activeSessionId && globalEnabled && isEnabled && projectPath) {
      const timer = setTimeout(() => {
        triggerSuperBro("session_start");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [activeSessionId, projectPath, globalEnabled, isEnabled, triggerSuperBro]);

  // Capture terminal output for error detection
  useEffect(() => {
    if (!activeSessionId || !globalEnabled || !isEnabled) return;

    const unsub = useActivityStore.subscribe((state) => {
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      const entries = state.sessionEntries.get(sid) ?? [];
      const lastEntry = entries[entries.length - 1];

      if (lastEntry?.toolName === "bash" && lastEntry.result) {
        terminalEntries.current.push(lastEntry.result.slice(-4000));
        if (terminalEntries.current.length > 3) {
          terminalEntries.current.shift();
        }
        terminalBuffer.current = terminalEntries.current.join("\n---\n");

        for (const pattern of BUILD_ERROR_PATTERNS) {
          if (pattern.test(lastEntry.result)) {
            triggerSuperBro("build_error");
            return;
          }
        }

        for (const pattern of TEST_FAILURE_PATTERNS) {
          if (pattern.test(lastEntry.result)) {
            triggerSuperBro("test_failure");
            return;
          }
        }
      }
    });

    return unsub;
  }, [activeSessionId, globalEnabled, isEnabled, triggerSuperBro]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (deferredRetryTimer.current) clearTimeout(deferredRetryTimer.current);
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (streamCleanup.current) streamCleanup.current();
    };
  }, []);
}
