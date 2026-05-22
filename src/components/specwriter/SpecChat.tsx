import { useRef, useEffect, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import {
  getProviderForModel,
  SPEC_WRITING_MODELS,
  SPEC_CLAUDE_CODE_MODELS,
  DEFAULT_SPEC_CLAUDE_CODE_MODEL,
  SPECWRITER_WEAK_MODELS,
  isSpecModelAvailable,
  autoSelectSpecModel,
  getSpecModelLabel,
} from "../../types/assistant-provider";
import { formatDuration } from "../../lib/format-utils";
import type { SpecAttachment } from "../../types/spec-writer";
import SpecChatMessage from "./SpecChatMessage";
import SpecChatInput from "./SpecChatInput";
import { CapabilityHandshakeBanner } from "./CapabilityHandshakeBanner";
import { resolveAgentForTaskNow } from "../../lib/agent-resolver";

interface Props {
  projectPath: string;
  isOpen?: boolean;
  contextLoading?: boolean;
  contextError?: string | null;
  onOptionAction?: (option: string) => boolean;
  onPromoteToSpec?: (messageId: string) => void;
  sendMessage: (projectPath: string, content: string, attachments?: SpecAttachment[]) => Promise<void>;
  writeSpec: (projectPath: string) => void;
  cancelStream: (projectPath: string) => void;
}

export default function SpecChat({ projectPath, isOpen, contextLoading, contextError, onOptionAction, onPromoteToSpec, sendMessage, writeSpec, cancelStream }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const isLoadingFiles = useSpecWriterStore((s) => s.fileRequestsPending.get(projectPath) ?? false);
  const updateConversationProvider = useSpecWriterStore((s) => s.updateConversationProvider);
  const setConversationMode = useSpecWriterStore((s) => s.setConversationMode);
  const apiKeys = useSettingsStore((s) => s.settings.apiKeys);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Global Esc key to stop streaming (works even when textarea is not focused)
  useEffect(() => {
    if (!isStreaming) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelStream(projectPath);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isStreaming, cancelStream, projectPath]);

  // Init a fresh conversation if none exists. v1.5.0 Phase 1: the
  // initial provider comes from the per-task resolver ("spec_writer"
  // category) — defaults to Claude Code unless the user routed
  // SpecWriter to Codex in Settings → Agents. Codex picks its own
  // default model so we pass an empty model string for it.
  useEffect(() => {
    if (!conversation) {
      const resolved = resolveAgentForTaskNow("spec_writer");
      if (resolved === "codex") {
        useSpecWriterStore.getState().initConversation(
          projectPath, "codex", "", "feature"
        );
      } else {
        useSpecWriterStore.getState().initConversation(
          projectPath, "claude-code", DEFAULT_SPEC_CLAUDE_CODE_MODEL, "feature"
        );
      }
    }
  }, [projectPath, conversation]);

  // Elapsed timer: track how long the AI has been responding
  useEffect(() => {
    if (isStreaming) {
      setStreamStartTime(Date.now());
    } else {
      setStreamStartTime(null);
      setElapsed(0);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (!streamStartTime) return;
    setElapsed(Date.now() - streamStartTime);
    const timer = setInterval(() => {
      setElapsed(Date.now() - streamStartTime);
    }, 1000);
    return () => clearInterval(timer);
  }, [streamStartTime]);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    // Only trigger re-render if value actually changed
    setShowScrollButton((prev) => {
      const next = !atBottom;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // ResizeObserver: re-scroll when content height changes during streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current && el) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Force-scroll on new user messages; auto-scroll when at bottom
  useEffect(() => {
    const msgs = conversation?.messages ?? [];
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = msgs.length;

    if (msgs.length > prevCount && prevCount > 0) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.role === "user") {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          isAtBottomRef.current = true;
          setShowScrollButton(false);
        }
        return;
      }
    }

    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages, isStreaming]);

  const handleWriteSpec = useCallback(() => {
    writeSpec(projectPath);
  }, [projectPath, writeSpec]);

  const handleSelectOption = useCallback(
    (option: string) => {
      // Allow parent to intercept specific option actions (e.g. audit generation, CLAUDE.md)
      if (onOptionAction?.(option)) return;
      sendMessage(projectPath, option);
    },
    [projectPath, sendMessage, onOptionAction]
  );

  const messages = conversation?.messages ?? [];
  const hasUserMessages = messages.some((m) => m.role === "user");

  const currentModel = conversation?.ai_model ?? "";
  const currentProvider = conversation?.ai_provider ?? "";
  // Local CLI providers (claude-code, codex) share the same SpecWriter
  // hook surface (useSpecConversationClaude — see B.1) and don't
  // require an API key. Codex is gated only by the empty-string model
  // (its CLI picks the default itself).
  const isClaudeCode = currentProvider === "claude-code";
  const isCodex = currentProvider === "codex";
  const isLocalCli = isClaudeCode || isCodex;

  const handleProviderChange = useCallback(
    (newProvider: string) => {
      if (newProvider === "claude-code") {
        updateConversationProvider(projectPath, "claude-code", DEFAULT_SPEC_CLAUDE_CODE_MODEL);
      } else if (newProvider === "codex") {
        // Codex's CLI picks its own default model when `model` is empty;
        // the live `model/list` later refreshes the ModelSelector.
        updateConversationProvider(projectPath, "codex", "");
      } else {
        // Pick the first model for this provider that has an API key
        const model = SPEC_WRITING_MODELS.find(
          (m) => m.provider === newProvider && isSpecModelAvailable(m.id, apiKeys)
        );
        updateConversationProvider(
          projectPath,
          newProvider,
          model?.id ?? autoSelectSpecModel(apiKeys),
        );
      }
    },
    [projectPath, updateConversationProvider, apiKeys]
  );

  const handleSpecModelChange = useCallback(
    (newModelId: string) => {
      if (isClaudeCode) {
        updateConversationProvider(projectPath, "claude-code", newModelId);
      } else if (isCodex) {
        updateConversationProvider(projectPath, "codex", newModelId);
      } else {
        const provider = getProviderForModel(newModelId) ?? "gemini";
        updateConversationProvider(projectPath, provider, newModelId);
      }
    },
    [projectPath, updateConversationProvider, isClaudeCode, isCodex]
  );

  const handleModeChange = useCallback(
    (mode: 'feature' | 'new_application') => {
      setConversationMode(projectPath, mode);
    },
    [projectPath, setConversationMode]
  );

  // Check if current model has an API key (local CLIs don't need one).
  const currentModelHasKey = isLocalCli || isSpecModelAvailable(currentModel, apiKeys);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 text-ui font-medium border-b shrink-0 flex items-center gap-2"
        style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
      >
        <span>SpecWriter Chat</span>
        {isStreaming && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-detail"
            style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent)" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent)" }} />
            </span>
            AI is responding...
            {elapsed > 5000 && (
              <span className="font-mono opacity-70 ml-0.5">{formatDuration(elapsed, "elapsed")}</span>
            )}
          </span>
        )}
        {conversation && !hasUserMessages ? (
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Provider selector */}
            <select
              value={currentProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="px-1.5 py-0.5 rounded-md border text-ui"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex (local)</option>
              {["gemini", "openai", "anthropic", "openrouter"].map((p) => {
                const hasKey = !!apiKeys[p]?.trim();
                const labels: Record<string, string> = {
                  gemini: "Gemini", openai: "OpenAI",
                  anthropic: "Anthropic", openrouter: "OpenRouter",
                };
                return (
                  <option key={p} value={p} disabled={!hasKey}>
                    {labels[p] ?? p}{!hasKey ? " (no key)" : ""}
                  </option>
                );
              })}
            </select>
            {/* Model selector */}
            <select
              value={currentModel}
              onChange={(e) => handleSpecModelChange(e.target.value)}
              className="px-1.5 py-0.5 rounded-md border text-ui"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {isClaudeCode
                ? SPEC_CLAUDE_CODE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))
                : SPEC_WRITING_MODELS
                    .filter((m) => m.provider === currentProvider)
                    .map((m) => {
                      const hasKey = isSpecModelAvailable(m.id, apiKeys);
                      return (
                        <option key={m.id} value={m.id} disabled={!hasKey}>
                          {m.label}{!hasKey ? " (no key)" : ""}
                        </option>
                      );
                    })
              }
            </select>
          </div>
        ) : conversation ? (
          <span className="ml-auto opacity-60 text-detail">
            {isClaudeCode ? "Claude Code" : ""} {getSpecModelLabel(conversation.ai_model)}
          </span>
        ) : null}
      </div>

      {/* API key warning banner */}
      {conversation && !currentModelHasKey && (
        <div
          className="px-3 py-2 text-ui flex items-center gap-2 border-b shrink-0"
          style={{
            background: "rgba(245,158,11,0.1)",
            borderColor: "var(--border)",
            color: "#f59e0b",
          }}
        >
          <span>No API key set for this model&apos;s provider.</span>
          <button
            onClick={() => useUiStore.getState().openSettingsToTab("ai-providers")}
            className="underline font-medium hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            Settings &rarr; AI Providers
          </button>
        </div>
      )}

      {/* Weak model warning banner */}
      {conversation && currentModelHasKey && SPECWRITER_WEAK_MODELS.some((m) => currentModel.includes(m)) && (
        <div
          className="px-3 py-2 text-ui flex items-center gap-2 border-b shrink-0"
          style={{
            background: "rgba(245,158,11,0.1)",
            borderColor: "var(--border)",
            color: "#f59e0b",
          }}
        >
          <span>This model may struggle with complex specifications. For best results, use Sonnet 4.6, Gemini 3.0 Flash, or GPT-5.4.</span>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={checkAtBottom} className="h-full overflow-y-auto px-3 py-2 space-y-3">
        <CapabilityHandshakeBanner projectPath={projectPath} />
        {messages.length === 0 && (
          <div className="text-center py-8 text-chat" style={{ color: "var(--text-dim)" }}>
            Describe what you want to build. The AI will ask clarifying questions before writing a specification.
          </div>
        )}
        {messages.map((msg, idx) => {
          const isLastAssistant =
            msg.role === "assistant" &&
            idx === messages.length - 1;
          return (
            <SpecChatMessage
              key={msg.id}
              message={msg}
              isLastAssistant={isLastAssistant}
              onSelectOption={handleSelectOption}
              onPromoteToSpec={onPromoteToSpec}
            />
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
            <span className="text-ui" style={{ color: "var(--text-dim)" }}>Thinking...</span>
            {elapsed > 0 && (
              <span className="text-detail font-mono" style={{ color: "var(--text-ghost)" }}>
                {formatDuration(elapsed, "elapsed")}
              </span>
            )}
          </div>
        )}
        {isLoadingFiles && (
          <div className="flex items-center gap-2 py-1 px-3">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--warning, #f59e0b)" }} />
            <span className="text-ui" style={{ color: "var(--text-dim)" }}>Loading requested files...</span>
          </div>
        )}
      </div>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-ui shadow-lg hover:brightness-95 transition-colors z-10"
          style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          <ArrowDown size={12} />
          <span>New messages</span>
        </button>
      )}
      </div>

      {conversation?.status === "ready_to_write" && (
        <div className="px-3 py-2 border-t" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={handleWriteSpec}
            disabled={isStreaming}
            className="w-full py-2 px-3 rounded-md text-chat font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Generate Spec
          </button>
        </div>
      )}

      {/* Mode indicator / selector */}
      <div
        className="px-3 py-1.5 border-t text-detail flex items-center gap-2"
        style={{ borderColor: "var(--border)", color: "var(--text-ghost)" }}
      >
        {conversation && !hasUserMessages ? (
          <>
            <span>Mode:</span>
            <select
              value={conversation.mode}
              onChange={(e) => handleModeChange(e.target.value as 'feature' | 'new_application')}
              className="px-1 py-0.5 rounded border text-detail"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="feature">Feature (existing project)</option>
              <option value="new_application">New Application</option>
            </select>
            {conversation.mode === 'feature' && (
              <span>
                Context: {contextLoading ? '\u23F3 scanning...' : contextError ? '\u274C error' : conversation.context_loaded ? '\u2705 loaded' : '\u2014'}
              </span>
            )}
          </>
        ) : (
          <>
            <span>Mode: {conversation?.mode === 'feature' ? 'Feature' : 'New Application'}</span>
            {conversation?.mode === 'feature' && (
              <span>
                Context: {contextLoading ? '\u23F3 scanning...' : contextError ? '\u274C error' : conversation?.context_loaded ? '\u2705 loaded' : '\u2014'}
              </span>
            )}
          </>
        )}
      </div>

      <SpecChatInput projectPath={projectPath} isOpen={isOpen} sendMessage={sendMessage} cancelStream={cancelStream} />
    </div>
  );
}
