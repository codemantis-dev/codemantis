import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Polyfill ResizeObserver for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill IntersectionObserver for jsdom (ActivityFeed, ChatPanel lazy loading)
global.IntersectionObserver = class IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
};

// Polyfill matchMedia for jsdom (theme-aware components)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollIntoView (used by chat scroll logic)
Element.prototype.scrollIntoView = vi.fn();

// Mock URL.createObjectURL/revokeObjectURL (attachment previews)
URL.createObjectURL = vi.fn(() => "blob:mock-url");
URL.revokeObjectURL = vi.fn();

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock @tauri-apps/api/webview (used by useFileDrop for drag-drop events)
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// Mock @tauri-apps/api/window (used by some Tauri APIs internally)
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// Mock @tauri-apps/plugin-log (used by error-handler and the [plan-modal]
// diagnostic instrumentation in activity.ts and PlanCompleteModal.tsx).
// Tests that want to assert on log calls can re-mock locally with vi.mock
// in the test file — this default no-op is safe because logs are
// fire-and-forget side effects.
vi.mock("@tauri-apps/plugin-log", () => ({
  trace: vi.fn(() => Promise.resolve()),
  debug: vi.fn(() => Promise.resolve()),
  info: vi.fn(() => Promise.resolve()),
  warn: vi.fn(() => Promise.resolve()),
  error: vi.fn(() => Promise.resolve()),
}));

// Swallow a specific known flake from @radix-ui/react-focus-scope:
// it schedules a setTimeout(0) during Dialog/Popover unmount that
// dispatches a CustomEvent on the now-detached DOM node. On jsdom 28
// the stricter Event-IDL converter throws "parameter 1 is not of type
// 'Event'", and Vitest 4.x escalates the throw to a CI suite failure
// even though no real test actually failed. (Bit v1.1.6 CI; reproduced
// once locally — manifests under specific timing only.)
//
// Filter is scoped to exactly that error message + stack frame, so
// genuine unhandled errors still surface. Listener is installed once at
// module load and stays for the test session — no per-test cost.
window.addEventListener(
  "error",
  (event: ErrorEvent) => {
    const msg = event.error?.message ?? event.message ?? "";
    const stack: string = event.error?.stack ?? "";
    if (
      msg.includes("dispatchEvent") &&
      msg.includes("parameter 1 is not of type 'Event'") &&
      stack.includes("react-focus-scope")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true },
);

// Clean up after each test to prevent state leaks
afterEach(() => {
  cleanup();
});
