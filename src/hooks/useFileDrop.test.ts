import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// The global setup.ts already mocks @tauri-apps/api/webview.
// We reconfigure the mock here to capture the drag-drop handler.
let capturedHandler: ((event: { payload: unknown }) => void) | null = null;

function setupMock(): void {
  capturedHandler = null;
  vi.mocked(getCurrentWebview).mockReturnValue({
    onDragDropEvent: vi.fn((handler: (event: { payload: unknown }) => void) => {
      capturedHandler = handler;
      return Promise.resolve(() => { capturedHandler = null; });
    }),
  } as unknown as ReturnType<typeof getCurrentWebview>);
}

// We need a fresh module for each test to reset the singleton state.
// Use dynamic import after resetting the module registry.
async function importHook(): Promise<typeof import("./useFileDrop")> {
  return import("./useFileDrop");
}

function createRef(rect?: Partial<DOMRect>): React.RefObject<HTMLDivElement> {
  const defaultRect: DOMRect = {
    x: 0, y: 0, width: 400, height: 100, top: 500, left: 0, right: 400, bottom: 600,
    toJSON: () => ({}),
  };
  const el = {
    getBoundingClientRect: () => ({ ...defaultRect, ...rect }),
  } as unknown as HTMLDivElement;
  return { current: el };
}

function fireEvent(type: string, extra: Record<string, unknown> = {}): void {
  if (!capturedHandler) throw new Error("No drag-drop handler registered");
  capturedHandler({ payload: { type, ...extra } });
}

describe("useFileDrop", () => {
  beforeEach(() => {
    vi.resetModules();
    setupMock();
  });

  it("registers a global Tauri listener on mount", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef();
    const onDrop = vi.fn();

    const { unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop })
    );

    await act(async () => {});
    expect(capturedHandler).not.toBeNull();

    unmount();
  });

  it("does not register when enabled=false", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef();
    const onDrop = vi.fn();

    const { unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop, enabled: false })
    );

    await act(async () => {});

    // With enabled=false, no entry in registry — drop should not trigger
    if (capturedHandler) {
      fireEvent("drop", { paths: ["/file.txt"], position: { x: 100, y: 550 } });
    }
    expect(onDrop).not.toHaveBeenCalled();

    unmount();
  });

  it("returns isDragOver=false initially", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef();
    const { result, unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop: vi.fn() })
    );

    expect(result.current.isDragOver).toBe(false);
    unmount();
  });

  it("sets isDragOver=true when cursor enters the container bounds", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef({ top: 500, bottom: 600, left: 0, right: 400 });
    const { result, unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop: vi.fn() })
    );
    await act(async () => {});

    act(() => fireEvent("enter", { paths: ["/file.txt"], position: { x: 200, y: 550 } }));
    expect(result.current.isDragOver).toBe(true);

    unmount();
  });

  it("sets isDragOver=false when cursor leaves", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef({ top: 500, bottom: 600, left: 0, right: 400 });
    const { result, unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop: vi.fn() })
    );
    await act(async () => {});

    act(() => fireEvent("enter", { paths: ["/file.txt"], position: { x: 200, y: 550 } }));
    expect(result.current.isDragOver).toBe(true);

    act(() => fireEvent("leave"));
    expect(result.current.isDragOver).toBe(false);

    unmount();
  });

  it("calls onDrop with paths when files are dropped inside bounds", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef({ top: 500, bottom: 600, left: 0, right: 400 });
    const onDrop = vi.fn();
    const { unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop })
    );
    await act(async () => {});

    act(() => fireEvent("drop", { paths: ["/a.txt", "/b.png"], position: { x: 200, y: 550 } }));
    expect(onDrop).toHaveBeenCalledWith(["/a.txt", "/b.png"]);

    unmount();
  });

  it("uses priority-based fallback when position misses all zones", async () => {
    const { useFileDrop } = await importHook();
    const refLow = createRef({ top: 500, bottom: 600, left: 0, right: 400, height: 100, width: 400 });
    const refHigh = createRef({ top: 200, bottom: 300, left: 0, right: 400, height: 100, width: 400 });
    const onDropLow = vi.fn();
    const onDropHigh = vi.fn();

    const { unmount: u1 } = renderHook(() =>
      useFileDrop({ id: "low", containerRef: refLow, onDrop: onDropLow, priority: 1 })
    );
    const { unmount: u2 } = renderHook(() =>
      useFileDrop({ id: "high", containerRef: refHigh, onDrop: onDropHigh, priority: 10 })
    );
    await act(async () => {});

    // Drop at y=50 — misses both zones (low: 500-600, high: 200-300)
    act(() => fireEvent("drop", { paths: ["/file.txt"], position: { x: 200, y: 50 } }));

    // Fallback: highest priority visible handler wins
    expect(onDropHigh).toHaveBeenCalledWith(["/file.txt"]);
    expect(onDropLow).not.toHaveBeenCalled();

    u1();
    u2();
  });

  it("clears isDragOver after drop", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef({ top: 0, bottom: 100, left: 0, right: 400 });
    const { result, unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop: vi.fn() })
    );
    await act(async () => {});

    act(() => fireEvent("enter", { paths: ["/f.txt"], position: { x: 200, y: 50 } }));
    expect(result.current.isDragOver).toBe(true);

    act(() => fireEvent("drop", { paths: ["/f.txt"], position: { x: 200, y: 50 } }));
    expect(result.current.isDragOver).toBe(false);

    unmount();
  });

  it("does not call onDrop with empty paths", async () => {
    const { useFileDrop } = await importHook();
    const ref = createRef({ top: 0, bottom: 100, left: 0, right: 400 });
    const onDrop = vi.fn();
    const { unmount } = renderHook(() =>
      useFileDrop({ id: "test", containerRef: ref, onDrop })
    );
    await act(async () => {});

    act(() => fireEvent("drop", { paths: [], position: { x: 200, y: 50 } }));
    expect(onDrop).not.toHaveBeenCalled();

    unmount();
  });
});
