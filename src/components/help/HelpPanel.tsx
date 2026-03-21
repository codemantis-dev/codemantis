import { useEffect, useCallback, useRef } from "react";
import { HelpCircle, X, Loader2, RotateCcw, Home } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useHelpSession } from "../../hooks/useHelpSession";
import { interruptSession } from "../../lib/tauri-commands";
import HelpWelcome from "./HelpWelcome";
import HelpChat from "./HelpChat";
import HelpChatInput from "./HelpChatInput";
import { EMPTY_ARRAY } from "../../lib/empty-refs";

/** Number of initial messages hidden (system prompt + acknowledgment). */
const HIDDEN_PREFIX = 2;

export default function HelpPanel() {
  const helpPanelOpen = useUiStore((s) => s.helpPanelOpen);
  const helpSessionId = useUiStore((s) => s.helpSessionId);
  const helpSessionReady = useUiStore((s) => s.helpSessionReady);
  const helpError = useUiStore((s) => s.helpError);
  const helpShowWelcome = useUiStore((s) => s.helpShowWelcome);
  const setHelpPanelOpen = useUiStore((s) => s.setHelpPanelOpen);
  const setHelpShowWelcome = useUiStore((s) => s.setHelpShowWelcome);

  const { initHelpSession, sendHelpMessage } = useHelpSession();
  const initCalledRef = useRef(false);

  // Start help session on first open
  useEffect(() => {
    if (helpPanelOpen && !helpSessionId && !initCalledRef.current) {
      initCalledRef.current = true;
      initHelpSession();
    }
  }, [helpPanelOpen, helpSessionId, initHelpSession]);

  // Escape key to close panel OR stop generation
  useEffect(() => {
    if (!helpPanelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If busy, stop generation first instead of closing
        const id = useUiStore.getState().helpSessionId;
        if (id) {
          const busy = useSessionStore.getState().sessionBusy.get(id);
          if (busy) {
            e.preventDefault();
            e.stopPropagation();
            interruptSession(id).catch((err) =>
              console.error("Failed to interrupt help session:", err)
            );
            return;
          }
        }
        setHelpPanelOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [helpPanelOpen, setHelpPanelOpen]);

  const handleClose = useCallback(() => {
    setHelpPanelOpen(false);
  }, [setHelpPanelOpen]);

  const handleRetry = useCallback(() => {
    useUiStore.getState().setHelpError(null);
    useUiStore.getState().setHelpSessionId(null);
    useUiStore.getState().setHelpSessionReady(false);
    initCalledRef.current = false;
    initHelpSession();
  }, [initHelpSession]);

  const handleBackToHome = useCallback(() => {
    setHelpShowWelcome(true);
  }, [setHelpShowWelcome]);

  const handleStop = useCallback(() => {
    const id = useUiStore.getState().helpSessionId;
    if (!id) return;
    interruptSession(id).catch((err) =>
      console.error("Failed to interrupt help session:", err)
    );
  }, []);

  const handleSuggestionClick = useCallback(
    (text: string) => {
      sendHelpMessage(text);
      // sendHelpMessage already sets helpShowWelcome = false
    },
    [sendHelpMessage]
  );

  // Read messages to determine if conversation exists
  const allMessages = useSessionStore(
    (s) => helpSessionId ? s.sessionMessages.get(helpSessionId) ?? EMPTY_ARRAY : EMPTY_ARRAY
  );
  const isStreaming = useSessionStore(
    (s) => helpSessionId ? s.sessionStreaming.get(helpSessionId)?.isStreaming ?? false : false
  );
  const isBusy = useSessionStore(
    (s) => helpSessionId ? s.sessionBusy.get(helpSessionId) ?? false : false
  );
  const visibleMessages = allMessages.slice(HIDDEN_PREFIX);
  const hasConversation = visibleMessages.length > 0;

  const isLoading = helpPanelOpen && !helpSessionReady && !helpError;

  // Show welcome if: no messages yet, OR user explicitly toggled back to home
  const showWelcomeView = !hasConversation || helpShowWelcome;

  return (
    <div
      className="fixed right-0 bottom-0 z-40 flex flex-col transition-transform duration-250 ease-out"
      style={{
        top: 48,
        width: 400,
        transform: helpPanelOpen ? "translateX(0)" : "translateX(100%)",
        background: "var(--bg-primary)",
        borderLeft: "1px solid var(--border)",
      }}
    >
      {/* Header */}
      <div
        className="h-10 flex items-center justify-between px-4 border-b shrink-0"
        style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      >
        <div className="flex items-center gap-2">
          <HelpCircle size={14} style={{ color: "var(--accent)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            CodeMantis Help
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Home button — visible when viewing chat (not welcome) and conversation exists */}
          {helpSessionReady && hasConversation && !helpShowWelcome && (
            <button
              onClick={handleBackToHome}
              title="Back to Help home"
              className="p-1 rounded hover:bg-bg-elevated transition-colors"
              style={{ color: "var(--text-ghost)" }}
            >
              <Home size={15} />
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: "var(--text-ghost)" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Starting help assistant...
          </p>
        </div>
      )}

      {helpError && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
            Failed to start help assistant.
          </p>
          <p className="text-xs text-center" style={{ color: "var(--text-dim)" }}>
            {helpError}
          </p>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors hover:brightness-95"
            style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
          >
            <RotateCcw size={13} />
            Retry
          </button>
        </div>
      )}

      {helpSessionReady && showWelcomeView && (
        <div className="flex-1 overflow-y-auto">
          <HelpWelcome onSuggestionClick={handleSuggestionClick} />
        </div>
      )}

      {helpSessionReady && !showWelcomeView && helpSessionId && (
        <HelpChat sessionId={helpSessionId} isBusy={isBusy} />
      )}

      {/* Input — shown when ready */}
      {helpSessionReady && helpSessionId && (
        <HelpChatInput
          onSend={sendHelpMessage}
          onStop={handleStop}
          disabled={isStreaming}
          isBusy={isBusy}
        />
      )}
    </div>
  );
}
