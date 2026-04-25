import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type {
  DevServerDetectedPayload,
  DevServerClosedPayload,
} from "../lib/tauri-commands";

type DetectedCb = (event: DevServerDetectedPayload) => void;
type ClosedCb = (event: DevServerClosedPayload) => void;

let capturedDetectedCb: DetectedCb | null = null;
let capturedClosedCb: ClosedCb | null = null;
const mockUnlistenDetected = vi.fn();
const mockUnlistenClosed = vi.fn();

vi.mock("../lib/tauri-commands", () => ({
  listenDevServerDetected: vi.fn((cb: DetectedCb) => {
    capturedDetectedCb = cb;
    return Promise.resolve(mockUnlistenDetected);
  }),
  listenDevServerClosed: vi.fn((cb: ClosedCb) => {
    capturedClosedCb = cb;
    return Promise.resolve(mockUnlistenClosed);
  }),
}));

const mockAddDetectedDevServer = vi.fn();
const mockRemoveDetectedDevServersForTerminal = vi.fn();

vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state: Record<string, unknown> = {
        addDetectedDevServer: mockAddDetectedDevServer,
        removeDetectedDevServersForTerminal: mockRemoveDetectedDevServersForTerminal,
      };
      return selector(state);
    },
    {
      getState: () => ({
        addDetectedDevServer: mockAddDetectedDevServer,
        removeDetectedDevServersForTerminal: mockRemoveDetectedDevServersForTerminal,
      }),
    }
  ),
}));

import { useDevServerDetection } from "./useDevServerDetection";

describe("useDevServerDetection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDetectedCb = null;
    capturedClosedCb = null;
  });

  it("registers both listeners on mount", async () => {
    await act(async () => {
      renderHook(() => useDevServerDetection());
    });

    // Wait for the async setup to complete
    await act(async () => {
      await Promise.resolve();
    });

    expect(capturedDetectedCb).not.toBeNull();
    expect(capturedClosedCb).not.toBeNull();
  });

  it("calls addDetectedDevServer when detection event fires", async () => {
    await act(async () => {
      renderHook(() => useDevServerDetection());
    });

    await act(async () => {
      await Promise.resolve();
    });

    const payload: DevServerDetectedPayload = {
      terminalId: "term-1",
      sessionId: "session-1",
      port: 3000,
      url: "http://localhost:3000",
    };

    act(() => {
      capturedDetectedCb!(payload);
    });

    expect(mockAddDetectedDevServer).toHaveBeenCalledWith({
      terminalId: "term-1",
      sessionId: "session-1",
      port: 3000,
      url: "http://localhost:3000",
    });
  });

  it("calls removeDetectedDevServersForTerminal when closed event fires", async () => {
    await act(async () => {
      renderHook(() => useDevServerDetection());
    });

    await act(async () => {
      await Promise.resolve();
    });

    const payload: DevServerClosedPayload = {
      terminalId: "term-1",
      sessionId: "session-1",
      reason: "pty_eof",
    };

    act(() => {
      capturedClosedCb!(payload);
    });

    expect(mockRemoveDetectedDevServersForTerminal).toHaveBeenCalledWith("term-1");
  });

  it("cleanup calls unlisten functions", async () => {
    let unmount: () => void;

    await act(async () => {
      const hook = renderHook(() => useDevServerDetection());
      unmount = hook.unmount;
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      unmount!();
    });

    expect(mockUnlistenDetected).toHaveBeenCalled();
    expect(mockUnlistenClosed).toHaveBeenCalled();
  });
});
