# Unit Test Patterns

## TypeScript

### Store Tests

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useMyStore } from "../../stores/myStore";

function resetStore() {
  useMyStore.setState({ /* initial state */ });
}

describe("myStore", () => {
  beforeEach(resetStore);

  it("someAction updates state correctly", () => {
    useMyStore.getState().someAction("value");
    expect(useMyStore.getState().someField).toBe("value");
  });
});
```

### Hook Tests

```typescript
import { renderHook } from "@testing-library/react";
import { useMyHook } from "../../hooks/useMyHook";

it("returns expected value", () => {
  const { result } = renderHook(() => useMyHook());
  expect(result.current.value).toBe(expected);
});
```

### Component Tests

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyComponent } from "./MyComponent";

it("renders and handles click", async () => {
  render(<MyComponent />);
  await userEvent.click(screen.getByRole("button"));
  expect(screen.getByText("clicked")).toBeInTheDocument();
});
```

## Rust

### Serde Roundtrip

```rust
#[test]
fn my_struct_serializes_correctly() {
    let value = MyStruct { field: "test".into() };
    let json = serde_json::to_string(&value).unwrap();
    let parsed: MyStruct = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.field, "test");
}
```

### Database Tests

```rust
use crate::test_helpers::test_db;

#[test]
fn insert_and_query() {
    let db = test_db();
    db.insert_session("s1", "Test", "/tmp", "connected", "2026-01-01T00:00:00Z", None, 0).unwrap();
    let sessions = db.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
}
```
