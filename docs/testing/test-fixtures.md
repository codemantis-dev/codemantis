# Test Fixtures

## TypeScript Event Fixtures

Located in `src/test/helpers/event-fixtures.ts`. Typed factory functions for all FrontendEvent variants.

### Individual Events

```typescript
import {
  createTextDeltaEvent,
  createToolUseStartEvent,
  createTurnCompleteEvent,
  createProcessExitedEvent,
} from "../helpers/event-fixtures";

const delta = createTextDeltaEvent("Hello", "session-1");
const tool = createToolUseStartEvent("Write", { file_path: "src/main.ts" });
const turn = createTurnCompleteEvent({ cost_usd: 0.05 });
```

### Pre-built Sequences

```typescript
import {
  createSimpleTurnSequence,
  createToolUseTurnSequence,
  createErrorTurnSequence,
  createRateLimitTurnSequence,
} from "../helpers/event-fixtures";

// Simple text turn: delta → delta → complete → turn_complete
const events = createSimpleTurnSequence("session-1");

// Tool turn: delta → complete → tool_use → tool_result → delta → complete → turn_complete
const toolEvents = createToolUseTurnSequence("Write", "session-1");
```

## Store Reset

```typescript
import { resetAllStores } from "../helpers/store-reset";

beforeEach(() => {
  resetAllStores(); // Resets all 17 Zustand stores to initial state
});
```

## Tauri Mock Factory

```typescript
import { createMockInvokeForSession } from "../helpers/tauri-mock-factory";

beforeEach(() => {
  createMockInvokeForSession({
    read_file_content: () => "custom content",
  });
});
```

## Rust Fixtures

Located in `src-tauri/src/test_helpers.rs`.

```rust
use crate::test_helpers::{test_db, test_db_with_sessions, test_app_state};

let db = test_db();                        // In-memory DB, all migrations run
let db = test_db_with_sessions(5);         // DB with 5 pre-populated sessions
let state = test_app_state();              // AppState with empty in-memory DB
```
