import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { checkClaudeStatus, wakePong } from "./tauri-commands";

/**
 * Soft / hard recovery for the WKWebView after long sleep or staleness.
 *
 * Two complementary signals:
 *   1. **Backend-initiated** — the Rust wake-observer emits `wake-from-sleep`
 *      every ~30 s. We reply with `wake_pong` so it knows the WebView is
 *      alive. If we don't reply, the Rust side force-reloads us.
 *   2. **Frontend-initiated** — on `visibilitychange`, if the document was
 *      hidden longer than `STALE_THRESHOLD_MS`, we ping the backend with a
 *      cheap command; on failure we reload ourselves.
 *
 * Both paths are needed: (1) catches a fully-dead content process (no JS
 * runs, only Rust can fix it); (2) catches the merely-stale case where IPC
 * listeners or websockets dropped but the JS context is still alive.
 */

export const WAKE_EVENT = "wake-from-sleep";
const STALE_THRESHOLD_MS = 60_000;
const PING_TIMEOUT_MS = 3_000;

/** For tests — overrides `Date.now()` and the reload callback. */
export interface WakeRecoveryDeps {
  now: () => number;
  reload: () => void;
  ping: () => Promise<unknown>;
  pong: () => Promise<unknown>;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

const defaultDeps: WakeRecoveryDeps = {
  now: () => Date.now(),
  reload: () => window.location.reload(),
  ping: () => checkClaudeStatus(),
  pong: () => wakePong(),
  // Indirect via globalThis at call time so vi.useFakeTimers() can swap the
  // implementation after this module has been imported.
  setTimeout: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    globalThis.setTimeout(handler, timeout, ...args)) as typeof globalThis.setTimeout,
  clearTimeout: ((id?: number) => globalThis.clearTimeout(id)) as typeof globalThis.clearTimeout,
};

/**
 * Handle returned by `installWakeRecovery`.
 *
 * - `cleanup` tears both recovery layers down (primarily for tests).
 * - `ready` resolves once the Tauri `wake-from-sleep` listener has been
 *   registered. Awaiting it guarantees the next backend ping won't be
 *   dropped due to a not-yet-registered listener. Production callers may
 *   ignore `ready` — listener registration is fast enough relative to the
 *   30 s observer cadence — but tests should await it before emitting.
 */
export interface WakeRecoveryHandle {
  cleanup: () => void;
  ready: Promise<void>;
}

/**
 * Install both recovery layers. Visibility handling is wired up
 * synchronously; the Tauri listener is registered asynchronously and its
 * readiness is exposed via the `ready` promise on the returned handle.
 */
export function installWakeRecovery(
  deps: Partial<WakeRecoveryDeps> = {}
): WakeRecoveryHandle {
  const d: WakeRecoveryDeps = { ...defaultDeps, ...deps };
  let lastHiddenAt: number | null = null;
  let unlistenWake: UnlistenFn | null = null;
  let visibilityHandler: (() => void) | null = null;

  // Backend ping → frontend pong.
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

  // Frontend visibility-based recovery.
  visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = d.now();
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (lastHiddenAt === null) return;

    const hiddenMs = d.now() - lastHiddenAt;
    lastHiddenAt = null;
    if (hiddenMs < STALE_THRESHOLD_MS) return;

    console.info(`[wake-recovery] document hidden for ${hiddenMs}ms — health-checking backend`);
    void pingOrReload(d, hiddenMs);
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  const cleanup = () => {
    if (unlistenWake) unlistenWake();
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
    }
  };

  return { cleanup, ready };
}

async function pingOrReload(d: WakeRecoveryDeps, hiddenMs: number): Promise<void> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = d.setTimeout(
      () => reject(new Error(`backend health-check timed out after ${PING_TIMEOUT_MS}ms`)),
      PING_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([d.ping(), timeoutPromise]);
  } catch (e) {
    console.warn(
      `[wake-recovery] backend unreachable after ${hiddenMs}ms hidden — reloading webview:`,
      e
    );
    d.reload();
    return;
  } finally {
    if (timer !== null) d.clearTimeout(timer);
  }
}

/** Test-only: exported thresholds so tests don't hard-code magic numbers. */
export const _internals = { STALE_THRESHOLD_MS, PING_TIMEOUT_MS };
