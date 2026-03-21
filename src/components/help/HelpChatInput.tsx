import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";

interface HelpChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  disabled: boolean;
  isBusy: boolean;
}

export default function HelpChatInput({ onSend, onStop, disabled, isBusy }: HelpChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const isActive = value.trim().length > 0 && !disabled;

  return (
    <div className="border-t border-border px-3 py-3 shrink-0">
      <div
        className="rounded-xl border border-border focus-within:border-accent/40 transition-colors"
        style={{ background: "var(--bg-elevated)" }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about CodeMantis... (⌘Enter to send)"
          disabled={disabled}
          rows={6}
          className="w-full resize-none bg-transparent px-4 py-3 text-chat text-text-primary placeholder:text-text-ghost outline-none"
        />

        {/* Action bar */}
        <div className="flex items-center justify-end px-3 pb-2">
          {isBusy ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-ui font-medium transition-all text-red hover:brightness-90"
              style={{ background: "color-mix(in srgb, var(--red) 15%, transparent)" }}
            >
              <Square size={12} />
              <span>Stop</span>
              <span className="text-label opacity-60">Esc</span>
            </button>
          ) : (
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
              <span className="text-label opacity-60">⌘↵</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
