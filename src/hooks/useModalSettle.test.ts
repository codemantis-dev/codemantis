import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModalSettle, MODAL_SETTLE_MS } from "./useModalSettle";

describe("useModalSettle", () => {
  it("reports settling for MODAL_SETTLE_MS after open flips true", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(1000);

    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalSettle(open),
      { initialProps: { open: false } },
    );

    // Closed → never settling.
    expect(result.current()).toBe(false);

    // Open: timestamp captured at 1000.
    rerender({ open: true });

    nowSpy.mockReturnValue(1000 + MODAL_SETTLE_MS - 1);
    expect(result.current()).toBe(true);

    nowSpy.mockReturnValue(1000 + MODAL_SETTLE_MS);
    expect(result.current()).toBe(false);

    nowSpy.mockRestore();
  });

  it("re-stamps the timestamp each time open flips false → true", () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(0);

    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useModalSettle(open),
      { initialProps: { open: true } },
    );

    // First open at t=0; settled by t=500.
    nowSpy.mockReturnValue(500);
    expect(result.current()).toBe(false);

    // Close, then re-open at t=10_000.
    act(() => rerender({ open: false }));
    nowSpy.mockReturnValue(10_000);
    act(() => rerender({ open: true }));

    // Now settling again until 10_000 + MODAL_SETTLE_MS.
    nowSpy.mockReturnValue(10_000 + 100);
    expect(result.current()).toBe(true);
    nowSpy.mockReturnValue(10_000 + MODAL_SETTLE_MS);
    expect(result.current()).toBe(false);

    nowSpy.mockRestore();
  });
});
