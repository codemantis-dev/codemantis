import type { Message } from "../types/session";

const ATTACHMENT_PREFIX_RE = /^(\[Attached file: [^\]]+\]\n*)+/;

/** Strip "[Attached file: ...]" prefixes from user message content. */
export function stripAttachmentRefs(content: string): string {
  return content.replace(ATTACHMENT_PREFIX_RE, "").trim();
}

/**
 * Extract the last N unique user messages from a message array.
 * Returns deduplicated strings (most recent wins), ordered oldest-first.
 */
export function getUserMessageHistory(messages: Message[], limit = 10): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  // Iterate newest-first to keep most recent occurrence of each unique text
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    const text = stripAttachmentRefs(msg.content);
    if (!text) continue;
    if (seen.has(text)) continue;

    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }

  // Reverse so oldest is first, newest is last (terminal-style)
  return result.reverse();
}
