/**
 * DuoAgentPane — one agent's live chat inside the Duo split view.
 *
 * Renders a real session's transcript (the session is registered in
 * `sessionStore` as a background session, so its chat streams in live) with a
 * per-agent model + effort selector. The PRIMARY pane is interactive (its own
 * input box, for mid-run guidance); the MENTOR pane is read-only (the
 * orchestrator drives it).
 */
import { useState } from "react";
import { Send } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useClaudeSession } from "../../hooks/useClaudeSession";
import { EMPTY_ARRAY, EMPTY_STREAMING } from "../../lib/empty-refs";
import MessageBubble from "../chat/MessageBubble";
import ThinkingIndicator from "../chat/ThinkingIndicator";
import ModelSelector from "../input/ModelSelector";
import EffortSelector from "../input/EffortSelector";

interface Props {
  sessionId: string;
  role: "primary" | "mentor";
}

export default function DuoAgentPane({ sessionId, role }: Props): React.ReactElement {
  const messages = useSessionStore((s) => s.sessionMessages.get(sessionId) ?? EMPTY_ARRAY);
  const streaming = useSessionStore((s) => s.sessionStreaming.get(sessionId) ?? EMPTY_STREAMING);
  const busy = useSessionStore((s) => s.sessionBusy.get(sessionId) ?? false);
  const { sendMessage } = useClaudeSession();

  const [draft, setDraft] = useState("");
  const isPrimary = role === "primary";

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    sendMessage(sessionId, text);
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header: role + per-agent model/effort + busy dot */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-detail font-semibold uppercase tracking-wide"
          style={{ color: isPrimary ? "var(--accent)" : "var(--text-secondary)" }}
        >
          {isPrimary ? "Primary" : "Mentor"}
        </span>
        {!isPrimary && (
          <span className="text-detail" style={{ color: "var(--text-dim)" }}>
            read-only
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ModelSelector sessionId={sessionId} />
          <EffortSelector sessionId={sessionId} />
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: busy ? "var(--green)" : "var(--text-faint)" }}
            title={busy ? "Working" : "Idle"}
          />
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {messages.length === 0 && !busy ? (
          <div className="text-detail" style={{ color: "var(--text-dim)" }}>
            {isPrimary ? "The primary will start working here." : "The mentor's reviews appear here."}
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              sessionId={sessionId}
              streamingContent={message.isStreaming ? streaming.streamingContent : undefined}
            />
          ))
        )}
        {busy && !streaming.isStreaming && <ThinkingIndicator sessionId={sessionId} />}
      </div>

      {/* Input — primary only (interactive); mentor is read-only */}
      {isPrimary && (
        <div
          className="flex items-end gap-2 px-3 py-2 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <textarea
            aria-label="Message the primary agent"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Guide the primary… (⌘↵ to send, even while it's working)"
            className="flex-1 resize-none rounded px-2 py-1.5 text-detail"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send to primary"
            className="p-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--bg-primary)", background: "var(--accent)" }}
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
