import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTriviaRotation } from "./useTriviaRotation";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTriviaRotation", () => {
  it("returns a fact immediately when active", () => {
    const { result } = renderHook(() => useTriviaRotation(true));
    expect(result.current.topic).toBeTruthy();
    expect(result.current.fact).toBeTruthy();
    expect(result.current.factKey).toBe(0);
  });

  it("rotates fact after 10 seconds", () => {
    const { result } = renderHook(() => useTriviaRotation(true));
    const initialKey = result.current.factKey;

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.factKey).toBe(initialKey + 1);
  });

  it("does not repeat same topic consecutively", () => {
    const { result } = renderHook(() => useTriviaRotation(true));

    for (let i = 0; i < 10; i++) {
      const prevTopic = result.current.topic;
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // Easter egg turns (every 50th) may have any topic, but for first 10 rotations this won't trigger
      expect(result.current.topic).not.toBe(prevTopic);
    }
  });

  it("shows easter egg on 50th rotation", () => {
    const { result } = renderHook(() => useTriviaRotation(true));

    // Advance 49 intervals (shownCount goes from 1 to 50; 50th triggers easter egg)
    act(() => {
      vi.advanceTimersByTime(10_000 * 49);
    });

    expect(result.current.isEasterEgg).toBe(true);
  });

  it("clears interval when active becomes false", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useTriviaRotation(active),
      { initialProps: { active: true } },
    );

    const keyAfterMount = result.current.factKey;

    rerender({ active: false });

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // factKey should not have changed after deactivation
    // (it resets to 0 when re-activated, but shouldn't increment while inactive)
    expect(result.current.factKey).toBe(keyAfterMount);
  });

  it("factKey increments on each rotation", () => {
    const { result } = renderHook(() => useTriviaRotation(true));
    const keys: number[] = [result.current.factKey];

    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      keys.push(result.current.factKey);
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).toBe(keys[i - 1] + 1);
    }
  });
});
