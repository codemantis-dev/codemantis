# Integration Test Patterns

Integration tests exercise a flow that crosses module boundaries **without mocking** the intermediate layers.

## TypeScript Integration Tests

### Setup

```typescript
import { resetAllStores } from "../helpers/store-reset";
import { simulateEventStream } from "../helpers/event-simulator";
import { createSimpleTurnSequence } from "../helpers/event-fixtures";
import { useSessionStore } from "../../stores/sessionStore";

// Mock ONLY the Tauri IPC boundary
vi.mock("../../lib/tauri-commands", () => ({ ... }));

beforeEach(() => {
  resetAllStores();
  // Seed stores with test data using REAL store APIs
  useSessionStore.getState().addSession({ ... });
});
```

### Pattern: Event Pipeline Test

```typescript
it("full turn creates message, sets stats, clears busy", () => {
  // Simulate CLI events through the REAL event pipeline
  simulateEventStream("s1", createSimpleTurnSequence("s1"));

  // Assert on REAL store state
  const messages = useSessionStore.getState().sessionMessages.get("s1");
  expect(messages).toHaveLength(1);
  expect(messages[0].turnStats).toBeDefined();
  expect(useSessionStore.getState().sessionBusy.get("s1")).toBeFalsy();
});
```

### What to Test

- Event flows: CLI event → event-classifier → store mutations
- Hook orchestration: hook → multiple stores → side effects
- Approval flow: enqueue → modal → resolve → dequeue
- Settings propagation: change setting → all consumers react

## Rust Integration Tests

Located in `src-tauri/tests/`. Use the library crate's public API.

```rust
// tests/database_migrations.rs
use codemantis_lib::test_helpers::test_db;

#[test]
fn fresh_database_creates_all_tables() {
    let db = test_db();
    // Query and verify schema
}
```

Note: If modules are not `pub`, add tests inline with `#[cfg(test)]` instead.
