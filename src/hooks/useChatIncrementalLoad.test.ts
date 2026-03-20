import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatIncrementalLoad } from "./useChatIncrementalLoad";

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

function makeScrollRef(scrollHeight = 1000): React.RefObject<HTMLDivElement | null> {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
  return { current: el };
}

describe("useChatIncrementalLoad", () => {
  it("computes correct startIndex (100 messages, 30 loaded → startIndex 70)", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 100, scrollRef })
    );
    expect(result.current.startIndex).toBe(70);
    expect(result.current.hasOlder).toBe(true);
  });

  it("defaults initialCount to 30", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 50, scrollRef })
    );
    expect(result.current.startIndex).toBe(20);
  });

  it("shows all messages when totalCount <= initialCount", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 10, scrollRef })
    );
    expect(result.current.startIndex).toBe(0);
    expect(result.current.hasOlder).toBe(false);
  });

  it("loads more on intersection, decreasing startIndex", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 100, initialCount: 30, batchSize: 20, scrollRef })
    );
    expect(result.current.startIndex).toBe(70);

    triggerIntersection(true);
    expect(result.current.startIndex).toBe(50);
  });

  it("caps at 0 startIndex", () => {
    const scrollRef = makeScrollRef();
    const { result } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 40, initialCount: 30, batchSize: 30, scrollRef })
    );
    expect(result.current.startIndex).toBe(10);

    triggerIntersection(true);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.hasOlder).toBe(false);
  });

  it("resets on session switch (resetKey change)", () => {
    const scrollRef = makeScrollRef();
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) =>
        useChatIncrementalLoad({ totalCount: 100, initialCount: 30, resetKey, scrollRef }),
      { initialProps: { resetKey: "session-1" } }
    );

    triggerIntersection(true);
    expect(result.current.startIndex).toBe(40);

    rerender({ resetKey: "session-2" });
    expect(result.current.startIndex).toBe(70);
  });

  it("new messages stay visible (totalCount growth doesn't move startIndex away from tail)", () => {
    const scrollRef = makeScrollRef();
    const { result, rerender } = renderHook(
      ({ totalCount }: { totalCount: number }) =>
        useChatIncrementalLoad({ totalCount, initialCount: 30, scrollRef, resetKey: "s1" }),
      { initialProps: { totalCount: 50 } }
    );
    expect(result.current.startIndex).toBe(20);

    // New message arrives (totalCount grows by 1)
    rerender({ totalCount: 51 });
    // startIndex should still show last 30 messages including the new one
    expect(result.current.startIndex).toBe(21);
    expect(result.current.hasOlder).toBe(true);
  });

  it("disconnects observer on unmount", () => {
    const scrollRef = makeScrollRef();
    const { unmount } = renderHook(() =>
      useChatIncrementalLoad({ totalCount: 100, scrollRef })
    );
    unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });
});
