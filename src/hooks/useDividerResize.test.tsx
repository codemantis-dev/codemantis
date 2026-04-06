import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDividerResize } from "./useDividerResize";

/**
 * Helper: creates a container div with a known width that the divider ref
 * can attach to (the hook reads parentElement.getBoundingClientRect()).
 */
function createContainer(width = 1000): {
  container: HTMLDivElement;
  divider: HTMLDivElement;
} {
  const container = document.createElement("div");
  const divider = document.createElement("div");
  container.appendChild(divider);
  document.body.appendChild(container);

  // Mock getBoundingClientRect on the container so the hook sees a known width
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    width,
    height: 600,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 600,
    toJSON: () => ({}),
  });

  return { container, divider };
}

describe("useDividerResize", () => {
  let rafCallbacks: Array<() => void>;
  let originalRaf: typeof requestAnimationFrame;
  let originalCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks = [];
    originalRaf = globalThis.requestAnimationFrame;
    originalCaf = globalThis.cancelAnimationFrame;

    // Mock requestAnimationFrame to capture callbacks for manual flushing
    let rafId = 0;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb as unknown as () => void);
      return ++rafId;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;

    // Clean up any container elements left in the DOM
    document.body.innerHTML = "";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  function flushRaf(): void {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach((cb) => cb());
  }

  it("returns isDragging=false initially", () => {
    const onWidthChange = vi.fn();
    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, onWidthChange }),
    );

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dividerRef).toBeDefined();
    expect(result.current.handleDividerMouseDown).toBeInstanceOf(Function);
  });

  it("handleDividerMouseDown sets isDragging=true", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, onWidthChange }),
    );

    // Attach the divider ref so the hook can find parentElement
    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(result.current.isDragging).toBe(true);

    // Clean up: fire mouseup to remove listeners
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    document.body.removeChild(container);
  });

  it("mousemove during drag calculates new width percentage", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    // Start drag at clientX=500
    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Move mouse 100px to the right (10% of 1000px container)
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 600 }));
    });

    // Flush the requestAnimationFrame callback
    act(() => {
      flushRaf();
    });

    // initialWidth=50, dx=100, dPct=10 => newPct=60
    expect(onWidthChange).toHaveBeenCalledWith(60);

    // Clean up
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    document.body.removeChild(container);
  });

  it("clamps width to minPct boundary", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 30, minPct: 25, maxPct: 65, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Move 200px left => dPct = -20, newPct = 30-20 = 10 => clamped to minPct=25
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    });
    act(() => {
      flushRaf();
    });

    expect(onWidthChange).toHaveBeenCalledWith(25);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    document.body.removeChild(container);
  });

  it("clamps width to maxPct boundary", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, minPct: 25, maxPct: 65, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Move 300px right => dPct = 30, newPct = 50+30 = 80 => clamped to maxPct=65
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 800 }));
    });
    act(() => {
      flushRaf();
    });

    expect(onWidthChange).toHaveBeenCalledWith(65);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    document.body.removeChild(container);
  });

  it("mouseup ends drag and restores cursor/userSelect", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    // Start dragging
    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    // Release mouse
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.isDragging).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    document.body.removeChild(container);
  });

  it("uses requestAnimationFrame for throttled updates", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Fire two rapid mousemove events without flushing RAF between them
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 550 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 600 }));
    });

    // Only one RAF should have been scheduled (the second move is dropped
    // because rafId !== null when the first hasn't fired yet)
    expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);

    // Flush the single RAF — should use the first move's coordinates
    act(() => {
      flushRaf();
    });

    expect(onWidthChange).toHaveBeenCalledTimes(1);
    // dx = 50 (first move), dPct = 5 => newPct = 55
    expect(onWidthChange).toHaveBeenCalledWith(55);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    document.body.removeChild(container);
  });

  it("respects custom minPct and maxPct options", () => {
    const onWidthChange = vi.fn();
    const { container, divider } = createContainer(1000);

    const { result } = renderHook(() =>
      useDividerResize({ initialWidth: 50, minPct: 10, maxPct: 90, onWidthChange }),
    );

    Object.defineProperty(result.current.dividerRef, "current", {
      value: divider,
      writable: true,
    });

    act(() => {
      result.current.handleDividerMouseDown({
        clientX: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Move 350px right => dPct=35, newPct=85 — within custom maxPct=90
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 850 }));
    });
    act(() => {
      flushRaf();
    });

    // Should be 85, not clamped to default maxPct of 65
    expect(onWidthChange).toHaveBeenCalledWith(85);

    onWidthChange.mockClear();

    // Now move far left: 850 => 50, dx = 50-500 = -450, dPct = -45,
    // newPct = 50-45 = 5 => clamped to custom minPct=10
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    act(() => {
      flushRaf();
    });

    expect(onWidthChange).toHaveBeenCalledWith(10);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    document.body.removeChild(container);
  });
});
