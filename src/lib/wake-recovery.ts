import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { wakePong } from "./tauri-commands";

/**
 * Backend → frontend liveness handshake.
 *
 * The Rust wake observer (`src-tauri/src/lifecycle/wake_observer.rs`)
 * emits a `wake-from-sleep` event every ~30 s. We reply via `wake_pong`
 * so it knows the WebView's JS context is still alive. If we don't reply
 * within its timeout, the Rust side asks AppKit to repaint the content
 * view (`setNeedsDisplay:`) — a non-destructive nudge that re-establishes
 * the compositing layer if it was torn down during a long screen-lock.
 *
 * This module previously also installed a `visibilitychange` handler
 * that called `window.location.reload()` if a backend ping timed out
 * after the document had been hidden > 60 s. That path was removed: it
 * triggered on *every* Mac unlock, dropped all in-memory UI state, and
 * dumped the user back on the start screen. With the bundle-level App
 * Nap opt-out (`Info.plist` `NSAppSleepDisabled`) and the Rust-side
 * activity assertion, the JS context stays warm enough that the pong
 * arrives in time. When it doesn't, repaint is the right response —
 * not a reload.
 */

export const WAKE_EVENT = "wake-from-sleep";

/** For tests — overrides the pong implementation. */
export interface WakeRecoveryDeps {
  pong: () => Promise<unknown>;
}

const defaultDeps: WakeRecoveryDeps = {
  pong: () => wakePong(),
};

/**
 * Handle returned by `installWakeRecovery`.
 *
 * - `cleanup` removes the wake-from-sleep listener (primarily for tests).
 * - `ready` resolves once the Tauri listener has been registered.
 *   Awaiting it guarantees the next backend ping won't be dropped due to
 *   a not-yet-registered listener.
 */
export interface WakeRecoveryHandle {
  cleanup: () => void;
  ready: Promise<void>;
}

/**
 * Register the `wake-from-sleep` listener that pongs the backend. Idempotent
 * at the call site — `main.tsx` invokes it once for the lifetime of the app.
 */
export function installWakeRecovery(
  deps: Partial<WakeRecoveryDeps> = {}
): WakeRecoveryHandle {
  const d: WakeRecoveryDeps = { ...defaultDeps, ...deps };
  let unlistenWake: UnlistenFn | null = null;

  const ready = listen(WAKE_EVENT, () => {
    void d.pong().catch((e) => {
      console.warn("[wake-recovery] wake_pong failed:", e);
    });
  }).then(
    (fn) => {
      unlistenWake = fn;
    },
    (e) => {
      console.warn("[wake-recovery] failed to register wake-from-sleep listener:", e);
    }
  );

  const cleanup = () => {
    if (unlistenWake) unlistenWake();
  };

  return { cleanup, ready };
}
