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
} from "../lib/tauri-commands";
// Provider resolution uses settings directly (no import needed from assistant-provider)

const DEBOUNCE_MS = 5000;
const RATE_LIMIT_MS = 30000;
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
      // For OpenRouter, pick cheapest free model or fallback
      const resolvedModel =
        provider === "openrouter" && model === "auto"
          ? "google/gemini-2.5-flash-preview-05-20:free"
          : model;
      return { provider, model: resolvedModel, apiKey: key };
    }
  }

  return null; // No API keys configured
}

export function useSuperBro(projectPath: string | null): void {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastApiCallTime = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalBuffer = useRef("");
  const pendingTrigger = useRef<SuperBroTrigger | null>(null);
  const fileCheckCount = useRef(0);
  const claudeMdCache = useRef<string | undefined>(undefined);
  const streamCleanup = useRef<(() => void) | null>(null);
  const prevMessageCount = useRef(0);
  const prevGuideSessionIndex = useRef<number | null>(null);

  const globalEnabled = useSettingsStore((s) => s.settings.superBroEnabled);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isPaused = useSuperBroStore((s) => s.isPaused);
  const isEnabled = useSuperBroStore((s) =>
    projectPath ? s.isEnabled(projectPath) : false,
  );

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

  // Main trigger function
  const triggerSuperBro = useCallback(
    (trigger: SuperBroTrigger) => {
      if (!projectPath || !globalEnabled || !isEnabled || isPaused) return;

      // Accumulate trigger (debounce: take latest)
      pendingTrigger.current = trigger;

      // Clear existing debounce timer
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      debounceTimer.current = setTimeout(() => {
        const currentTrigger = pendingTrigger.current;
        if (!currentTrigger) return;
        pendingTrigger.current = null;

        // Rate limit check
        const now = Date.now();
        if (now - lastApiCallTime.current < RATE_LIMIT_MS) return;

        // Execute the API call
        executeSuperBroCall(currentTrigger);
      }, DEBOUNCE_MS);
    },
    [projectPath, globalEnabled, isEnabled, isPaused],
  );

  // Execute the Super-Bro API call
  const executeSuperBroCall = useCallback(
    async (trigger: SuperBroTrigger) => {
      if (!projectPath) return;

      const settings = useSettingsStore.getState().settings;
      const resolved = resolveSuperBroProvider(settings);

      if (!resolved) {
        // No API key — show one-time note
        const store = useSuperBroStore.getState();
        if (!store.currentMessage) {
          store.setMessage({
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

      const store = useSuperBroStore.getState();
      store.setThinking(true);
      lastApiCallTime.current = Date.now();
      fileCheckCount.current = 0;

      try {
        // Build context
        const context = buildSuperBroContext(
          projectPath,
          terminalBuffer.current,
          undefined, // git status — would need async call
          claudeMdCache.current,
        );

        const observations = store.getObservations(projectPath);
        const { systemPrompt, userMessage } = await buildSuperBroRequest(
          trigger,
          context,
          observations,
        );

        // Make the API call via existing assistant chat infrastructure
        const responseText = await callSuperBroApi(
          resolved.provider,
          resolved.apiKey,
          resolved.model,
          systemPrompt,
          userMessage,
        );

        // Parse the response
        const parsed = parseSuperBroResponse(responseText);

        // Handle NOTHING_TO_REPORT
        if (parsed.isNothingToReport) {
          store.setThinking(false);
          return;
        }

        // Save any observations
        for (const obs of parsed.observations) {
          store.addObservation(projectPath, obs);
        }

        // Handle file check request
        if (parsed.fileCheckRequest && fileCheckCount.current < MAX_FILE_CHECKS) {
          fileCheckCount.current++;
          await handleFileCheck(
            resolved,
            systemPrompt,
            userMessage,
            responseText,
            parsed.fileCheckRequest,
            projectPath,
            trigger,
          );
          return;
        }

        // Set the message
        store.setMessage({
          id: `sb-${Date.now()}`,
          guidance: parsed.guidance,
          suggestedPrompt: parsed.suggestedPrompt,
          fileCheckRequest: parsed.fileCheckRequest,
          trigger,
          timestamp: new Date().toISOString(),
          dismissed: false,
        });
      } catch (e) {
        // Silent failure — Super-Bro is advisory
        console.error("[Super-Bro] API call failed:", e);
        store.setThinking(false);
      }
    },
    [projectPath],
  );

  // Handle file check flow
  const handleFileCheck = useCallback(
    async (
      resolved: { provider: string; model: string; apiKey: string },
      systemPrompt: string,
      originalUserMessage: string,
      firstResponse: string,
      filePath: string,
      projectPath: string,
      trigger: SuperBroTrigger,
    ) => {
      const store = useSuperBroStore.getState();
      try {
        const absolutePath = filePath.startsWith("/")
          ? filePath
          : `${projectPath}/${filePath}`;
        const fileContent = await readFileContent(absolutePath);

        // Follow-up API call with file content
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
          store.setThinking(false);
          return;
        }

        // Save observations from follow-up
        for (const obs of parsed.observations) {
          store.addObservation(projectPath, obs);
        }

        // Handle nested file check (up to MAX_FILE_CHECKS)
        if (
          parsed.fileCheckRequest &&
          fileCheckCount.current < MAX_FILE_CHECKS
        ) {
          fileCheckCount.current++;
          await handleFileCheck(
            resolved,
            systemPrompt,
            followUpMessage,
            responseText,
            parsed.fileCheckRequest,
            projectPath,
            trigger,
          );
          return;
        }

        store.setMessage({
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
        store.setThinking(false);
      }
    },
    [],
  );

  // Call the AI API using the existing assistant chat infrastructure
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

        // Clean up any previous listener
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
            maxTokens: 500,
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

  // ── Subscriptions ──────────────────────────────────────────────────

  // Watch for new assistant messages (claude_response trigger)
  useEffect(() => {
    if (!activeSessionId || !globalEnabled || !isEnabled) return;

    const unsub = useSessionStore.subscribe((state) => {
      const messages = state.sessionMessages.get(activeSessionId) ?? [];
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
      const errorCount = state.unreadErrors.get(projectPath) ?? 0;
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

      const activeSession = guide.sessions.find(
        (s) => s.status === "active",
      );
      const activeIdx = activeSession?.index ?? null;

      if (prevGuideSessionIndex.current !== null && activeIdx !== null) {
        if (activeIdx > prevGuideSessionIndex.current) {
          triggerSuperBro("guide_session_start");
        }
      }

      // Check for completed session
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

    // Reset on any session message change
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
      // Short delay to let session initialize
      const timer = setTimeout(() => {
        triggerSuperBro("session_start");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [activeSessionId, projectPath]); // Intentional: only trigger on session/project change

  // Capture terminal output for error detection
  useEffect(() => {
    if (!activeSessionId || !globalEnabled || !isEnabled) return;

    // Subscribe to activity store for terminal/bash outputs
    const unsub = useActivityStore.subscribe((state) => {
      if (!activeSessionId) return;
      const entries = state.sessionEntries.get(activeSessionId) ?? [];
      const lastEntry = entries[entries.length - 1];

      if (lastEntry?.toolName === "bash" && lastEntry.result) {
        terminalBuffer.current = lastEntry.result.slice(-2000);

        // Check for build errors
        for (const pattern of BUILD_ERROR_PATTERNS) {
          if (pattern.test(lastEntry.result)) {
            triggerSuperBro("build_error");
            return;
          }
        }

        // Check for test failures
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
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (streamCleanup.current) streamCleanup.current();
    };
  }, []);
}
