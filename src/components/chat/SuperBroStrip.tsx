import { useCallback, useEffect, useRef } from "react";
import { Copy, Play, FastForward, X, Pause, RotateCw, Loader2, Check, CircleDot } from "lucide-react";
import { useSuperBroStore } from "../../stores/superBroStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { showToast } from "../../stores/toastStore";
import { sendMessage as sendMessageCmd } from "../../lib/tauri-commands";

const ALL_GOOD_DISPLAY_MS = 4000;

export default function SuperBroStrip() {
  const globalEnabled = useSettingsStore((s) => s.settings.superBroEnabled);
  const currentMessage = useSuperBroStore((s) => s.currentMessage);
  const isThinking = useSuperBroStore((s) => s.isThinking);
  const isPaused = useSuperBroStore((s) => s.isPaused);
  const lastCheckResult = useSuperBroStore((s) => s.lastCheckResult);
  const dismiss = useSuperBroStore((s) => s.dismissCurrentMessage);
  const pause = useSuperBroStore((s) => s.pause);
  const resume = useSuperBroStore((s) => s.resume);
  const clearCheckResult = useSuperBroStore((s) => s.clearCheckResult);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const stripRef = useRef<HTMLDivElement>(null);

  // Auto-clear "all good" after a few seconds → back to "watching"
  useEffect(() => {
    if (lastCheckResult !== "all_good") return;
    const timer = setTimeout(clearCheckResult, ALL_GOOD_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [lastCheckResult, clearCheckResult]);

  // Keyboard: Escape dismisses when focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stripRef.current?.contains(document.activeElement)) {
        dismiss();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dismiss]);

  // Copy prompt to clipboard
  const handleCopy = useCallback(() => {
    if (currentMessage?.suggestedPrompt) {
      navigator.clipboard.writeText(currentMessage.suggestedPrompt);
      showToast("Prompt copied", "info");
    }
  }, [currentMessage]);

  // Paste prompt into chat input (Send)
  const handleSend = useCallback(() => {
    if (currentMessage?.suggestedPrompt) {
      useUiStore.getState().setDraftInput(currentMessage.suggestedPrompt);
      dismiss();
    }
  }, [currentMessage, dismiss]);

  // Send prompt directly to Claude Code (Send & Execute)
  const handleSendAndExecute = useCallback(async () => {
    if (!currentMessage?.suggestedPrompt || !activeSessionId) {
      if (!activeSessionId) {
        showToast("No active Claude Code session", "info");
      }
      return;
    }

    try {
      useSessionStore.getState().addMessage(activeSessionId, {
        id: `user-sb-${Date.now()}`,
        role: "user",
        content: currentMessage.suggestedPrompt,
        timestamp: new Date().toISOString(),
        activityIds: [],
        isStreaming: false,
      });

      await sendMessageCmd(activeSessionId, currentMessage.suggestedPrompt);
      dismiss();
    } catch (e) {
      console.error("[Super-Bro] Send & Execute failed:", e);
      showToast("Failed to send prompt", "error");
    }
  }, [currentMessage, activeSessionId, dismiss]);

  if (!globalEnabled) return null;

  // ── Paused State ─────────────────────────────────────────────
  if (isPaused) {
    return (
      <div
        ref={stripRef}
        className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-border text-text-ghost text-label"
        style={{ background: "var(--bg-secondary)" }}
      >
        <Pause size={13} className="text-text-ghost" />
        <span className="flex-1">Super-Bro · paused</span>
        <button
          onClick={resume}
          className="flex items-center gap-1 px-2 py-1 rounded text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors text-label"
          title="Resume Super-Bro"
        >
          <RotateCw size={12} />
          Resume
        </button>
      </div>
    );
  }

  // ── Analysing State ──────────────────────────────────────────
  if (isThinking) {
    return (
      <div
        ref={stripRef}
        className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-border text-text-dim text-label"
        style={{ background: "var(--bg-secondary)" }}
      >
        <Loader2 size={13} className="animate-spin text-accent" />
        <span>Super-Bro · analysing...</span>
      </div>
    );
  }

  // ── All Good State (transient — auto-clears) ─────────────────
  if (lastCheckResult === "all_good") {
    return (
      <div
        ref={stripRef}
        className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-border text-label"
        style={{ background: "var(--bg-secondary)" }}
      >
        <Check size={13} className="text-green" />
        <span className="text-green">Super-Bro · all good</span>
        <button
          onClick={pause}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-text-ghost hover:text-text-dim hover:bg-bg-elevated transition-colors text-label"
          title="Pause Super-Bro"
        >
          <Pause size={12} />
          Pause
        </button>
      </div>
    );
  }

  // ── Active Message State ─────────────────────────────────────
  if (currentMessage && !currentMessage.dismissed) {
    return (
      <div
        ref={stripRef}
        tabIndex={-1}
        className="shrink-0 border-t border-l-2 border-accent overflow-y-auto transition-all duration-300 ease-out"
        style={{
          maxHeight: 150,
          background: "var(--bg-secondary)",
          borderTopColor: "var(--border)",
        }}
      >
        <div className="px-4 py-3">
          {/* Guidance text */}
          <div className="flex items-start gap-2">
            <CircleDot size={14} className="shrink-0 mt-0.5 text-accent" />
            <p className="flex-1 text-text-secondary text-ui leading-relaxed">
              {currentMessage.guidance}
            </p>
            <button
              onClick={dismiss}
              className="shrink-0 p-1 rounded text-text-ghost hover:text-text-dim hover:bg-bg-elevated transition-colors"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>

          {/* Suggested prompt block */}
          {currentMessage.suggestedPrompt && (
            <div className="mt-2 ml-6">
              <div
                className="px-3 py-2 rounded-md text-label text-text-dim leading-relaxed"
                style={{ background: "var(--bg-elevated)" }}
              >
                {currentMessage.suggestedPrompt}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-label text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
                  title="Copy prompt to clipboard"
                >
                  <Copy size={12} />
                  Copy Prompt
                </button>
                <button
                  onClick={handleSend}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-label text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
                  title="Paste into chat input"
                >
                  <Play size={12} />
                  Send
                </button>
                <button
                  onClick={handleSendAndExecute}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-label text-accent hover:bg-accent/10 transition-colors font-medium"
                  title="Send directly to Claude Code"
                >
                  <FastForward size={12} />
                  Send &amp; Execute
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Watching (Idle) State ────────────────────────────────────
  return (
    <div
      ref={stripRef}
      className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-border text-text-ghost text-label"
      style={{ background: "var(--bg-secondary)" }}
    >
      <CircleDot size={13} className="text-text-ghost" />
      <span className="flex-1">Super-Bro · watching</span>
      <button
        onClick={pause}
        className="flex items-center gap-1 px-2 py-1 rounded text-text-ghost hover:text-text-dim hover:bg-bg-elevated transition-colors text-label"
        title="Pause Super-Bro"
      >
        <Pause size={12} />
        Pause
      </button>
    </div>
  );
}
