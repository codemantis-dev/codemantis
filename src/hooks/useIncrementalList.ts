import { useState, useRef, useEffect, useCallback } from "react";

interface UseIncrementalListOptions {
  totalCount: number;
  initialCount?: number;
  batchSize?: number;
  resetKey?: string | null;
}

interface UseIncrementalListReturn {
  visibleCount: number;
  hasMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  reset: () => void;
}

export function useIncrementalList({
  totalCount,
  initialCount = 30,
  batchSize = 30,
  resetKey = null,
}: UseIncrementalListOptions): UseIncrementalListReturn {
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => {
    setVisibleCount(initialCount);
  }, [initialCount]);

  // Reset when resetKey changes
  useEffect(() => {
    setVisibleCount(initialCount);
  }, [resetKey, initialCount]);

  // Set up IntersectionObserver on the sentinel element
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + batchSize, totalCount));
        }
      },
      { rootMargin: "200px" }
    );

    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }
    return () => observer.disconnect();
  }, [batchSize, totalCount, resetKey]);

  const hasMore = visibleCount < totalCount;

  return { visibleCount, hasMore, sentinelRef, reset };
}
