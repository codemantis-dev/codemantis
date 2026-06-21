/**
 * Auto-grow a chat textarea — the same shrink-and-grow mechanism the main
 * InputArea uses: reset to `auto` so it can shrink, then grow to fit content up
 * to a row cap (beyond which it scrolls internally). Shared so the Duo primary
 * input matches the main window's comfortable, growing input.
 */
const LINE_HEIGHT_PX = 24;
const MAX_ROWS = 8;

export function autoGrowTextarea(el: HTMLTextAreaElement | null, maxRows = MAX_ROWS): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, maxRows * LINE_HEIGHT_PX) + "px";
}
