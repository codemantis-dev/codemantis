// ═══════════════════════════════════════════════════════════════════════
// CopyButton — reusable copy-to-clipboard affordance
//
// Single source of truth for the "click to copy + flash Check for 1.5s"
// pattern that had been re-implemented ad-hoc in MessageBubble, CodeBlock,
// and AssistantMessageMenu. Text is computed lazily so the snapshot is
// taken at click-time (not render-time) — callers can pass () => store.state
// without worrying about stale closures.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Check, Copy } from "lucide-react";
import { showToast as showToastFn } from "../../stores/toastStore";

interface CopyButtonProps {
  /** Lazy text producer. Called on click; snapshot at click-time. */
  getText: () => string;
  /** Tooltip text in the idle state. Defaults to "Copy". */
  label?: string;
  /** Extra classes merged onto the <button> element. */
  className?: string;
  /** Icon size in pixels. Defaults to 13 (matches existing hover icons). */
  size?: number;
  /** Fire a global toast on success. Defaults to false — the inline Check
   *  icon is usually enough, and toasts can be noisy on every Copy click. */
  showToast?: boolean;
}

/**
 * Render a button that copies `getText()` to the clipboard and briefly
 * flashes a Check icon. Safe to call `getText()` anytime; errors from
 * `navigator.clipboard.writeText` are swallowed silently (the user sees
 * the icon not flip to Check, and can retry).
 */
export default function CopyButton({
  getText,
  label = "Copy",
  className = "",
  size = 13,
  showToast = false,
}: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false);
  // Clear the timeout if the component unmounts mid-flash.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    const text = getText();
    // clipboard.writeText is async; swallow failures rather than surface
    // an error — the Check flash doubles as success signal.
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (showToast) showToastFn("Copied", "success", 1500);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1500);
      },
      () => { /* swallow */ },
    );
  }, [getText, showToast]);

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? "Copied" : label}
      aria-label={label}
      className={`inline-flex items-center justify-center p-1 rounded-md transition-colors hover:bg-bg-elevated text-text-ghost hover:text-text-secondary ${className}`.trim()}
    >
      <Icon size={size} />
    </button>
  );
}
