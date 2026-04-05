# CodeMantis Testing Guide

Tests exist to prevent regressions in a shipping desktop app. Every test should catch a real bug that could ship to users.

## Quick Start

```bash
pnpm test                              # TS unit tests
pnpm test:integration                  # TS integration tests
pnpm test:coverage                     # Coverage report → ./coverage/
cd src-tauri && cargo test             # Rust unit + integration tests
```

## Test Architecture

```
src/
  **/*.test.ts(x)                      # TS unit tests (co-located)
  test/
    setup.ts                           # Global test setup (Tauri mocks, polyfills)
    helpers/
      store-reset.ts                   # resetAllStores() for all 17 Zustand stores
      event-fixtures.ts                # Typed FrontendEvent factories
      event-simulator.ts               # Simulate CLI events through real pipeline
      tauri-mock-factory.ts            # Configurable invoke() mock dispatch
      render-helpers.tsx               # Component rendering with pre-seeded stores
      wait-helpers.ts                  # Async store polling utilities
    integration/
      *.integration.test.ts(x)         # TS integration tests

src-tauri/
  src/
    test_helpers.rs                    # Rust test fixtures (DB, AppState)
    **/*  (inline #[cfg(test)] mods)   # Rust unit tests
  tests/
    *.rs                               # Rust integration tests
```

## Decision Tree: Should I Write a Test?

- Adding a new store action? **Yes** — unit test the action
- Adding a new hook? **Yes** — unit test return values + side effects
- Adding a cross-module feature? **Yes** — integration test the flow
- Adding a new component? **Yes** — component test with user events
- Fixing a bug? **Yes** — regression test that fails without the fix
- Adding a type definition? **No** — unless it has runtime validation
- Re-exporting from a barrel file? **No**

## Documentation

- [Unit Tests](unit-tests.md) — patterns for stores, hooks, components, utilities
- [Integration Tests](integration-tests.md) — cross-module testing with real stores
- [Test Fixtures](test-fixtures.md) — shared test data and factories
- [Mocking Guide](mocking-guide.md) — when and how to mock
