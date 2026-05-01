import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mutable holder so tests can capture the registered wake-from-sleep
// listener and invoke it manually.
const wakeListenerHolder: { current: ((event: unknown) => void) | null } = {
  current: null,
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, cb: (event: unknown) => void) => {
    wakeListenerHolder.current = cb;
    return Promise.resolve(() => {
      wakeListenerHolder.current = null;
    });
  }),
}));
vi.mock("./tauri-commands", () => ({
  wakePong: vi.fn(),
}));

import { installWakeRecovery, WAKE_EVENT } from "./wake-recovery";

describe("installWakeRecovery", () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    wakeListenerHolder.current = null;
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ready resolves and wake-from-sleep event triggers wake_pong", async () => {
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({ pong });
    cleanup = handle.cleanup;

    await handle.ready;
    expect(wakeListenerHolder.current).not.toBeNull();

    wakeListenerHolder.current?.({});
    await vi.runAllTimersAsync();

    expect(pong).toHaveBeenCalledOnce();
  });

  it("repeated wake events each trigger a pong", async () => {
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({ pong });
    cleanup = handle.cleanup;
    await handle.ready;

    wakeListenerHolder.current?.({});
    wakeListenerHolder.current?.({});
    wakeListenerHolder.current?.({});
    await vi.runAllTimersAsync();

    expect(pong).toHaveBeenCalledTimes(3);
  });

  it("swallows pong errors so a transient IPC failure doesn't unhandle-reject", async () => {
    const pong = vi.fn().mockRejectedValue(new Error("boom"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const handle = installWakeRecovery({ pong });
    cleanup = handle.cleanup;
    await handle.ready;

    wakeListenerHolder.current?.({});
    await vi.runAllTimersAsync();

    expect(pong).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("cleanup unregisters the wake listener", async () => {
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({ pong });
    await handle.ready;
    expect(wakeListenerHolder.current).not.toBeNull();

    handle.cleanup();
    cleanup = null;
    expect(wakeListenerHolder.current).toBeNull();
  });

  it("does not register a visibilitychange handler on document", async () => {
    // Regression guard: the previous design installed a visibilitychange
    // listener that called window.location.reload() after long hidden
    // periods. That path was removed entirely. Verify by spying on
    // document.addEventListener and asserting nothing wires
    // "visibilitychange" during install.
    const pong = vi.fn().mockResolvedValue(1);
    const addSpy = vi.spyOn(document, "addEventListener");

    const handle = installWakeRecovery({ pong });
    cleanup = handle.cleanup;
    await handle.ready;

    const visibilityCalls = addSpy.mock.calls.filter(
      ([eventName]) => eventName === "visibilitychange"
    );
    expect(visibilityCalls).toHaveLength(0);
  });

  it("exports WAKE_EVENT name matching the Rust constant", () => {
    expect(WAKE_EVENT).toBe("wake-from-sleep");
  });
});
