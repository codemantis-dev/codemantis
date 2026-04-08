import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";

interface UseChatIncrementalLoadOptions {
  totalCount: number;
  initialCount?: number;
  batchSize?: number;
  resetKey?: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

interface UseChatIncrementalLoadReturn {
  startIndex: number;
  hasOlder: boolean;
  remainingCount: number;
  loadAll: () => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useChatIncrementalLoad({
  totalCount,
  initialCount = 80,
  batchSize = 80,
  resetKey = null,
  scrollRef,
}: UseChatIncrementalLoadOptions): UseChatIncrementalLoadReturn {
  const [loadedCount, setLoadedCount] = useState(initialCount);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const didLoadMoreRef = useRef(false);

  // Reset when session changes
  useEffect(() => {
    setLoadedCount(initialCount);
    didLoadMoreRef.current = false;
  }, [resetKey, initialCount]);

  // Set up IntersectionObserver on the sentinel (at top of list)
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const el = scrollRef.current;
          if (el) {
            prevScrollHeightRef.current = el.scrollHeight;
          }
          didLoadMoreRef.current = true;
          setLoadedCount((prev) => Math.min(prev + batchSize, totalCount));
        }
      },
      { root: scrollRef.current, rootMargin: "200px" }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }
    return () => observer.disconnect();
  }, [batchSize, totalCount, resetKey, scrollRef]);

  // Preserve scroll position after loading older messages
  useLayoutEffect(() => {
    if (!didLoadMoreRef.current) return;
    didLoadMoreRef.current = false;

    const el = scrollRef.current;
    if (!el) return;

    const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
    if (heightDiff > 0) {
      el.scrollTop += heightDiff;
    }
  }, [loadedCount, scrollRef]);

  const startIndex = Math.max(0, totalCount - loadedCount);
  const hasOlder = startIndex > 0;

  const loadAll = useCallback(() => {
    setLoadedCount(totalCount);
  }, [totalCount]);

  return { startIndex, hasOlder, remainingCount: startIndex, loadAll, sentinelRef };
}
