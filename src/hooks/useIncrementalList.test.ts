import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIncrementalList } from "./useIncrementalList";

// Mock IntersectionObserver
let observerCallback: IntersectionObserverCallback;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

beforeEach(() => {
  observeMock.mockClear();
  disconnectMock.mockClear();

  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      observerCallback = cb;
    }
    observe = observeMock;
    disconnect = disconnectMock;
    unobserve = vi.fn();
    root = null;
    rootMargin = "";
    thresholds = [] as number[];
    takeRecords = () => [] as IntersectionObserverEntry[];
  }

  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function triggerIntersection(isIntersecting: boolean): void {
  act(() => {
    observerCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  });
}

describe("useIncrementalList", () => {
  it("initializes visibleCount to initialCount", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 100, initialCount: 20 })
    );
    expect(result.current.visibleCount).toBe(20);
    expect(result.current.hasMore).toBe(true);
  });

  it("defaults initialCount to 30", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 100 })
    );
    expect(result.current.visibleCount).toBe(30);
  });

  it("increases visibleCount by batchSize on intersection", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 100, initialCount: 20, batchSize: 15 })
    );

    triggerIntersection(true);
    expect(result.current.visibleCount).toBe(35);
  });

  it("caps visibleCount at totalCount", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 10, initialCount: 8, batchSize: 5 })
    );

    triggerIntersection(true);
    expect(result.current.visibleCount).toBe(10);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not increase on non-intersecting trigger", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 100, initialCount: 20 })
    );

    triggerIntersection(false);
    expect(result.current.visibleCount).toBe(20);
  });

  it("resets visibleCount when resetKey changes", () => {
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useIncrementalList({ totalCount: 100, initialCount: 20, resetKey }),
      { initialProps: { resetKey: "a" } }
    );

    // Load more
    triggerIntersection(true);
    expect(result.current.visibleCount).toBe(50);

    // Switch session
    rerender({ resetKey: "b" });
    expect(result.current.visibleCount).toBe(20);
  });

  it("reset() resets visibleCount to initialCount", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 100, initialCount: 20 })
    );

    triggerIntersection(true);
    expect(result.current.visibleCount).toBe(50);

    act(() => result.current.reset());
    expect(result.current.visibleCount).toBe(20);
  });

  it("hasMore is false when totalCount <= initialCount", () => {
    const { result } = renderHook(() =>
      useIncrementalList({ totalCount: 5, initialCount: 30 })
    );
    expect(result.current.hasMore).toBe(false);
  });

  it("disconnects observer on unmount", () => {
    const { unmount } = renderHook(() =>
      useIncrementalList({ totalCount: 100 })
    );
    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });
});
