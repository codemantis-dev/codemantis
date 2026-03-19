import { useRef, useEffect, useCallback, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useSpecWriterStore } from "../../stores/specWriterStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSpecConversation } from "../../hooks/useSpecConversation";
import { AI_PROVIDERS, AI_MODELS, getProviderForModel } from "../../types/assistant-provider";
import type { APIProvider } from "../../types/assistant-provider";
import SpecChatMessage from "./SpecChatMessage";
import SpecChatInput from "./SpecChatInput";

interface Props {
  projectPath: string;
}

export default function SpecChat({ projectPath }: Props) {
  const conversation = useSpecWriterStore((s) => s.conversations.get(projectPath));
  const isStreaming = useSpecWriterStore((s) => s.planningStreaming.get(projectPath) ?? false);
  const isLoadingFiles = useSpecWriterStore((s) => s.fileRequestsPending.get(projectPath) ?? false);
  const updateConversationProvider = useSpecWriterStore((s) => s.updateConversationProvider);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { writeSpec, sendMessage } = useSpecConversation();

  // Init a fresh conversation if none exists.
  useEffect(() => {
    if (!conversation) {
      const settings = useSettingsStore.getState().settings;
      const planningModel = settings.taskBoardPlanningModel || 'gemini-2.5-flash';
      const provider = getProviderForModel(planningModel) ?? 'gemini';
      useSpecWriterStore.getState().initConversation(projectPath, provider, planningModel, 'new_application');
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
      sendMessage(projectPath, option);
    },
    [projectPath, sendMessage]
  );

  const messages = conversation?.messages ?? [];
  const hasUserMessages = messages.some((m) => m.role === "user");

  // Filter providers: exclude claude-code for spec writing
  const availableProviders = AI_PROVIDERS.filter((p) => p.id !== "claude-code");
  const currentProvider = conversation?.ai_provider ?? "gemini";
  const currentModel = conversation?.ai_model ?? "";

  const handleProviderChange = useCallback(
    (newProvider: string) => {
      const models = AI_MODELS[newProvider as APIProvider];
      const newModel = models?.[0]?.id ?? "";
      updateConversationProvider(projectPath, newProvider, newModel);
    },
    [projectPath, updateConversationProvider]
  );

  const handleModelChange = useCallback(
    (newModel: string) => {
      updateConversationProvider(projectPath, currentProvider, newModel);
    },
    [projectPath, currentProvider, updateConversationProvider]
  );

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
              value={currentProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="px-1.5 py-0.5 rounded-md border text-xs"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {availableProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={currentModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="px-1.5 py-0.5 rounded-md border text-xs"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {(AI_MODELS[currentProvider as APIProvider] ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ) : conversation ? (
          <span className="ml-auto opacity-60">
            ({conversation.ai_provider}/{conversation.ai_model})
          </span>
        ) : null}
      </div>

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
            Write Spec
          </button>
        </div>
      )}

      {/* Mode indicator */}
      <div
        className="px-3 py-1.5 border-t text-[10px] flex items-center gap-2"
        style={{ borderColor: "var(--border)", color: "var(--text-ghost)" }}
      >
        <span>Mode: {conversation?.mode === 'feature' ? 'Feature' : 'New Application'}</span>
        {conversation?.mode === 'feature' && (
          <span>
            Context: {conversation.context_loaded ? '✅ loaded' : '⏳ loading...'}
          </span>
        )}
      </div>

      <SpecChatInput projectPath={projectPath} />
    </div>
  );
}
