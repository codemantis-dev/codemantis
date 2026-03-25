/**
 * Determines whether a keyboard event should trigger a message send,
 * based on the user's configured send shortcut.
 */
export function shouldSend(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  shortcut: string
): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false; // Shift+Enter always inserts newline
  if (shortcut === "enter") return !e.metaKey && !e.ctrlKey;
  return e.metaKey || e.ctrlKey; // "cmd+enter" (default)
}

/** Returns a human-readable label for the send shortcut hint. */
export function sendShortcutLabel(shortcut: string): string {
  return shortcut === "enter" ? "↵" : "⌘↵";
}

/** Returns a human-readable phrase like "Enter to send" or "⌘+Enter to send". */
export function sendShortcutHint(shortcut: string): string {
  return shortcut === "enter" ? "Enter to send" : "⌘+Enter to send";
}
