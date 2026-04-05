/**
 * Async wait utilities for integration tests.
 * Use these when testing event-driven flows that update stores asynchronously.
 */
import type { StoreApi } from "zustand";

/**
 * Wait until a Zustand store's state matches the predicate.
 * Polls the store state every 10ms until the predicate returns true or timeout.
 *
 * @example
 * await waitForStoreUpdate(
 *   useSessionStore,
 *   (state) => state.sessionBusy.get("s1") === false,
 *   5000
 * );
 */
export async function waitForStoreUpdate<T>(
  store: StoreApi<T>,
  predicate: (state: T) => boolean,
  timeoutMs: number = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(store.getState())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`waitForStoreUpdate timed out after ${timeoutMs}ms`);
}

/**
 * Wait for the microtask queue to flush.
 * Useful after dispatching events that trigger async store updates.
 */
export async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a specific number of milliseconds.
 * Use sparingly — prefer waitForStoreUpdate with a predicate.
 */
export async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
