# Mocking Guide

## What to Mock

| Boundary | Always Mock | Why |
|----------|------------|-----|
| Tauri IPC | `invoke`, `listen`, `emit` | Backend not running in tests |
| Filesystem | File reads/writes | Tests must be deterministic |
| Network | HTTP requests, API calls | No external dependencies |
| Timers | `setTimeout`, `setInterval` | Tests must be fast and deterministic |
| Clipboard | `navigator.clipboard` | Browser API not available in jsdom |

## What NOT to Mock

| Module | Use Real | Why |
|--------|----------|-----|
| Zustand stores | `useXxxStore.getState()` | Catches real integration bugs |
| Pure functions | Direct import | No side effects to control |
| Type definitions | Direct import | No behavior to mock |
| Event handlers | Direct import | Core business logic under test |

## Tauri Mocking

### Global Setup (src/test/setup.ts)
All tests get a default `invoke` mock that returns `undefined`. Override per-test:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

vi.mocked(invoke).mockImplementation((cmd) => {
  if (cmd === "get_settings") return Promise.resolve({ theme: "dark" });
  return Promise.resolve(undefined);
});
```

### Mock Factory (recommended)

```typescript
import { createMockInvokeForSession } from "../helpers/tauri-mock-factory";

// Pre-configured mocks for common session commands
createMockInvokeForSession({
  read_file_content: () => "file content here",
});
```

## Timer Mocking

```typescript
import { vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("retries after delay", () => {
  triggerAction();
  vi.advanceTimersByTime(30000); // 30s
  expect(retryWasCalled).toBe(true);
});
```

## Store Testing Anti-patterns

```typescript
// BAD: Mocking the store
vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ ... }) },
}));

// GOOD: Using the real store with controlled state
useSessionStore.setState({ sessions: new Map([["s1", testSession]]) });
```
