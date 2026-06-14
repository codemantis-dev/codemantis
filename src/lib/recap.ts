import type { Message } from "../types/session";

/**
 * Conversation-recap helpers for the Codex "Recover session" flow.
 *
 * When a Codex thread's auto-compaction fails, recovery starts a *fresh*
 * thread (empty context). To keep continuity we prime that thread with a
 * recap of the prior conversation — ideally an LLM summary, but falling back
 * to a bounded verbatim tail when no summarizer API key is configured.
 *
 * Both builders are pure so they're unit-testable without a live session.
 */

/** Max characters of transcript we feed the LLM summarizer. The tail is the
 * most relevant part for continuing work, and an unbounded transcript could be
 * millions of tokens (the very reason compaction was attempted). */
export const MAX_TRANSCRIPT_CHARS = 24_000;

/** Budget (chars ≈ tokens×4) for carrying the FULL displayed chat into a fresh
 * resumed Codex thread. ~120K tokens. The displayed chat excludes tool outputs,
 * so it's far smaller than Codex's internal context — usually it fits verbatim,
 * giving the new thread the real prior conversation rather than a summary. */
export const RESUME_CONTEXT_BUDGET_CHARS = 480_000;

/** How many recent turns the local fallback recap quotes verbatim. */
export const LOCAL_RECAP_MESSAGES = 6;

/** Per-message truncation in the local fallback recap. */
export const LOCAL_RECAP_PER_MESSAGE_CHARS = 600;

/** Skip system/error cards (restart/retry/recover prompts, Self-Drive
 * injections) so the recap reflects the real conversation, not our own UI. */
function isConversational(m: Message): boolean {
  return !m.restartable && !m.retryable && !m.recoverable && !m.selfDriveEvent;
}

function label(role: Message["role"]): string {
  return role === "user" ? "User" : "Assistant";
}

/**
 * Build a role-tagged transcript string from the tail of the conversation,
 * bounded to `maxChars`. Used as the LLM summarizer's input.
 */
export function buildTranscriptText(
  messages: Message[],
  maxChars: number = MAX_TRANSCRIPT_CHARS,
): string {
  const convo = messages.filter(isConversational);
  const lines: string[] = [];
  let total = 0;
  // Walk from the end so we keep the most recent context within budget.
  for (let i = convo.length - 1; i >= 0; i--) {
    const m = convo[i];
    const text = m.content.trim();
    if (!text) continue;
    const line = `${label(m.role)}: ${text}`;
    if (total + line.length > maxChars && lines.length > 0) break;
    lines.push(line);
    total += line.length;
  }
  lines.reverse();
  return lines.join("\n\n");
}

/** Total characters of the conversational (non-card) messages — used to decide
 * whether the full chat fits the resume-context budget. */
export function conversationalCharCount(messages: Message[]): number {
  return messages
    .filter(isConversational)
    .reduce((sum, m) => sum + m.content.trim().length, 0);
}

/**
 * Build a local fallback recap (no LLM): a bounded, truncated verbatim tail of
 * recent turns, wrapped with a short framing note so the fresh thread knows the
 * prior context was lost.
 */
export function buildLocalRecap(messages: Message[]): string {
  const convo = messages.filter(isConversational).filter((m) => m.content.trim());
  const tail = convo.slice(-LOCAL_RECAP_MESSAGES);
  if (tail.length === 0) {
    return "(The previous conversation could not be recapped — its context was lost.)";
  }
  const quoted = tail
    .map((m) => {
      const text = m.content.trim();
      const truncated =
        text.length > LOCAL_RECAP_PER_MESSAGE_CHARS
          ? `${text.slice(0, LOCAL_RECAP_PER_MESSAGE_CHARS)}…`
          : text;
      return `${label(m.role)}: ${truncated}`;
    })
    .join("\n\n");
  return (
    "Recap of the prior conversation (the earlier context was lost to a failed " +
    "compaction; the most recent messages are quoted below to restore continuity):\n\n" +
    quoted
  );
}
