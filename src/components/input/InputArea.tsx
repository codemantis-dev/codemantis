import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Plus, Slash, AtSign } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";

export default function InputArea() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const session = useSessionStore((s) => s.session);
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const { sendMessage } = useClaudeSession();

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !session || isStreaming) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await sendMessage(trimmed);
  }, [input, session, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 8 * 24; // 8 rows
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
  }, []);

  const isActive = input.trim().length > 0 && !!session && !isStreaming;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="max-w-[720px] mx-auto">
        {/* Textarea */}
        <div
          className="rounded-xl border border-border bg-bg-elevated transition-colors focus-within:border-accent/40"
          style={{ background: "var(--bg-elevated)" }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              session
                ? "Ask Claude anything... (\u2318+Enter to send)"
                : "Open a project to start..."
            }
            disabled={!session}
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 text-chat text-text-primary placeholder:text-text-ghost outline-none"
          />

          {/* Action bar */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <Plus size={13} />
                <span>File</span>
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <Slash size={13} />
                <span>Cmd</span>
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-label text-text-faint hover:text-text-dim hover:bg-bg-subtle transition-colors"
                disabled={!session}
              >
                <AtSign size={13} />
                <span>Agent</span>
              </button>
            </div>

            <button
              onClick={handleSend}
              disabled={!isActive}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all ${
                isActive
                  ? "bg-accent text-white hover:bg-accent-light"
                  : "bg-bg-subtle text-text-ghost cursor-not-allowed"
              }`}
            >
              <Send size={13} />
              <span>Send</span>
              <span className="text-label opacity-60">\u2318\u21B5</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
