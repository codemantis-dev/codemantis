import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sticky-bottom auto-scroll for a chat transcript — the exact behavior the main
 * ChatPanel uses, extracted so the Duo agent panes get it 100% identically:
 * - stays pinned to the bottom while new content streams in,
 * - releases when the user scrolls up (and shows a "new messages" button),
 * - force-scrolls to the bottom when the local user sends a message,
 * - re-pins on container/content reflow (ResizeObserver), ignoring reflow-only scrolls.
 *
 * Wire `onScroll` to the scroll container and `ref={scrollRef}`; render the
 * "New messages ↓" button when `showScrollButton` and call `scrollToBottom`.
 */
export function useStickToBottom<T extends { role: string }>(params: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messages: T[];
  streamingContent: string;
  isBusy: boolean;
}): {
  showScrollButton: boolean;
  scrollToBottom: () => void;
  onScroll: () => void;
} {
  const { scrollRef, messages, streamingContent, isBusy } = params;
  const isAtBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const lastClientHeightRef = useRef(0);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Swallow scroll events caused by container reflow (clientHeight change),
    // not real user scrolls — let the ResizeObserver settle the flags.
    if (el.clientHeight !== lastClientHeightRef.current) {
      lastClientHeightRef.current = el.clientHeight;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, [scrollRef]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollRef]);

  // Re-pin on container/content growth (streaming text, indicators).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    lastClientHeightRef.current = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const node = scrollRef.current;
      if (!node) return;
      if (isAtBottomRef.current) node.scrollTop = node.scrollHeight;
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom);
      lastClientHeightRef.current = node.clientHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  // New message: force-scroll on local user-send, otherwise stick if at bottom.
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prevCount && prevCount > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          isAtBottomRef.current = true;
          setShowScrollButton(false);
        }
        return;
      }
    }
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, isBusy, scrollRef]);

  return { showScrollButton, scrollToBottom, onScroll };
}
