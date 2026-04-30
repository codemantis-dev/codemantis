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
  checkClaudeStatus: vi.fn(),
  wakePong: vi.fn(),
}));

import { installWakeRecovery, _internals } from "./wake-recovery";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

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

  it("does not reload when document was hidden briefly", async () => {
    let nowMs = 1_000_000;
    const reload = vi.fn();
    const ping = vi.fn().mockResolvedValue({ ok: true });
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({
      now: () => nowMs,
      reload,
      ping,
      pong,
    });
    cleanup = handle.cleanup;
    await handle.ready;

    setVisibility("hidden");
    nowMs += 5_000; // < STALE_THRESHOLD_MS
    setVisibility("visible");
    await vi.runAllTimersAsync();

    expect(ping).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("pings backend after long hidden period and does not reload on success", async () => {
    let nowMs = 1_000_000;
    const reload = vi.fn();
    const ping = vi.fn().mockResolvedValue({ ok: true });
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({
      now: () => nowMs,
      reload,
      ping,
      pong,
    });
    cleanup = handle.cleanup;
    await handle.ready;

    setVisibility("hidden");
    nowMs += _internals.STALE_THRESHOLD_MS + 1;
    setVisibility("visible");
    await vi.runAllTimersAsync();

    expect(ping).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when backend ping rejects", async () => {
    let nowMs = 1_000_000;
    const reload = vi.fn();
    const ping = vi.fn().mockRejectedValue(new Error("ipc dead"));
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({
      now: () => nowMs,
      reload,
      ping,
      pong,
    });
    cleanup = handle.cleanup;
    await handle.ready;

    setVisibility("hidden");
    nowMs += _internals.STALE_THRESHOLD_MS + 1;
    setVisibility("visible");
    await vi.runAllTimersAsync();

    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads when backend ping never resolves (timeout)", async () => {
    let nowMs = 1_000_000;
    const reload = vi.fn();
    // Never-resolving ping forces the timeout race to win.
    const ping = vi.fn().mockReturnValue(new Promise(() => {}));
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({
      now: () => nowMs,
      reload,
      ping,
      pong,
    });
    cleanup = handle.cleanup;
    await handle.ready;

    setVisibility("hidden");
    nowMs += _internals.STALE_THRESHOLD_MS + 1;
    setVisibility("visible");

    // Advance past the ping timeout so the race rejects.
    await vi.advanceTimersByTimeAsync(_internals.PING_TIMEOUT_MS + 100);

    expect(reload).toHaveBeenCalledOnce();
  });

  it("ready resolves and wake-from-sleep event triggers wake_pong", async () => {
    const reload = vi.fn();
    const ping = vi.fn().mockResolvedValue({ ok: true });
    const pong = vi.fn().mockResolvedValue(1);

    const handle = installWakeRecovery({
      now: () => 1_000_000,
      reload,
      ping,
      pong,
    });
    cleanup = handle.cleanup;

    await handle.ready;
    expect(wakeListenerHolder.current).not.toBeNull();

    wakeListenerHolder.current?.({});
    await vi.runAllTimersAsync();

    expect(pong).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
