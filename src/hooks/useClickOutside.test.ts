import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClickOutside } from "./useClickOutside";

describe("useClickOutside", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("returns a ref object", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(true, onClose));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it("calls onClose when clicking outside the ref element", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(true, onClose));

    // Simulate attaching the ref
    const el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(result.current, "current", { value: el, writable: true });

    // Click outside
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    document.body.removeChild(el);
  });

  it("does NOT call onClose when clicking inside the ref element", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useClickOutside<HTMLDivElement>(true, onClose));

    const el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(result.current, "current", { value: el, writable: true });

    // Click inside
    act(() => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it("does NOT listen when isActive is false", () => {
    const onClose = vi.fn();
    renderHook(() => useClickOutside<HTMLDivElement>(false, onClose));

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape key when closeOnEscape is true", () => {
    const onClose = vi.fn();
    renderHook(() => useClickOutside<HTMLDivElement>(true, onClose, { closeOnEscape: true }));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on Escape key when closeOnEscape is not set", () => {
    const onClose = vi.fn();
    renderHook(() => useClickOutside<HTMLDivElement>(true, onClose));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("cleans up listeners on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() =>
      useClickOutside<HTMLDivElement>(true, onClose, { closeOnEscape: true })
    );

    unmount();

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-attaches listeners when isActive changes from false to true", () => {
    const onClose = vi.fn();
    const stableOnClose = () => onClose();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useClickOutside<HTMLDivElement>(active, stableOnClose),
      { initialProps: { active: false } }
    );

    // Attach ref to a DOM element
    const el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(result.current, "current", { value: el, writable: true });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    rerender({ active: true });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
  });
});
