import { useRef, useEffect, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { useSpecConversation } from "../../hooks/useSpecConversation";
import {
  getProviderForModel,
  SPEC_WRITING_MODELS,
  DEFAULT_SPEC_MODEL,
  isSpecModelAvailable,
  autoSelectSpecModel,
  getSpecModelLabel,
} from "../../types/assistant-provider";
import SpecChatMessage from "./SpecChatMessage";
import SpecChatInput from "./SpecChatInput";

interface Props {
  projectPath: string;
  contextLoading?: boolean;
  contextError?: string | null;
  onOptionAction?: (option: string) => boolean;
}

export default function SpecChat({ projectPath, contextLoading, contextError, onOptionAction }: Props) {
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
  const { writeSpec, sendMessage } = useSpecConversation();

  // Init a fresh conversation if none exists — default to 'feature' mode
  // Auto-select a model with an available API key if the default/saved one has no key
  useEffect(() => {
    if (!conversation) {
      const settings = useSettingsStore.getState().settings;
      const rawModel = settings.taskBoardPlanningModel || DEFAULT_SPEC_MODEL;
      const effectiveModel = isSpecModelAvailable(rawModel, settings.apiKeys)
        ? rawModel
        : autoSelectSpecModel(settings.apiKeys);
      const provider = getProviderForModel(effectiveModel) ?? 'gemini';
      useSpecWriterStore.getState().initConversation(projectPath, provider, effectiveModel, 'feature');
    }
  }, [projectPath, conversation]);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
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

  const handleSpecModelChange = useCallback(
    (newModelId: string) => {
      const provider = getProviderForModel(newModelId) ?? "gemini";
      updateConversationProvider(projectPath, provider, newModelId);
    },
    [projectPath, updateConversationProvider]
  );

  const handleModeChange = useCallback(
    (mode: 'feature' | 'new_application') => {
      setConversationMode(projectPath, mode);
    },
    [projectPath, setConversationMode]
  );

  // Check if current model has an API key
  const currentModelHasKey = isSpecModelAvailable(currentModel, apiKeys);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 text-xs font-medium border-b shrink-0 flex items-center gap-2"
        style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
      >
        <span>SpecWriter Chat</span>
        {isStreaming && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px]"
            style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "var(--accent)" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "var(--accent)" }} />
            </span>
            AI is responding...
          </span>
        )}
        {conversation && !hasUserMessages ? (
          <div className="flex items-center gap-1.5 ml-auto">
            <select
              value={currentModel}
              onChange={(e) => handleSpecModelChange(e.target.value)}
              className="px-1.5 py-0.5 rounded-md border text-xs"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {SPEC_WRITING_MODELS.map((m) => {
                const hasKey = isSpecModelAvailable(m.id, apiKeys);
                return (
                  <option key={m.id} value={m.id} disabled={!hasKey}>
                    {m.label}{!hasKey ? " (no key)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        ) : conversation ? (
          <span className="ml-auto opacity-60 text-[10px]">
            {getSpecModelLabel(conversation.ai_model)}
          </span>
        ) : null}
      </div>

      {/* API key warning banner */}
      {conversation && !currentModelHasKey && (
        <div
          className="px-3 py-2 text-xs flex items-center gap-2 border-b shrink-0"
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

      <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={checkAtBottom} className="h-full overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
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
            />
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-2 py-1">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>Thinking...</span>
          </div>
        )}
        {isLoadingFiles && (
          <div className="flex items-center gap-2 py-1 px-3">
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--warning, #f59e0b)" }} />
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>Loading requested files...</span>
          </div>
        )}
      </div>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs shadow-lg hover:brightness-95 transition-colors z-10"
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
            className="w-full py-2 px-3 rounded-md text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Generate Spec
          </button>
        </div>
      )}

      {/* Mode indicator / selector */}
      <div
        className="px-3 py-1.5 border-t text-[10px] flex items-center gap-2"
        style={{ borderColor: "var(--border)", color: "var(--text-ghost)" }}
      >
        {conversation && !hasUserMessages ? (
          <>
            <span>Mode:</span>
            <select
              value={conversation.mode}
              onChange={(e) => handleModeChange(e.target.value as 'feature' | 'new_application')}
              className="px-1 py-0.5 rounded border text-[10px]"
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

      <SpecChatInput projectPath={projectPath} />
    </div>
  );
}
