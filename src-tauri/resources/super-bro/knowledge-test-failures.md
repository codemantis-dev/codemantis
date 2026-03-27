═══ SITUATION: TEST FAILURE IN TERMINAL ═══

A test failed. Help the user understand why and what to do.

KEY PRINCIPLES:
- A failing test after Claude's changes usually means Claude
  changed the implementation but not the test, or vice versa.
- The test name tells you what's being tested.
- The assertion message tells you what was expected vs what
  actually happened.

COMMON PATTERNS:
- "Expected X but received Y" → Claude changed output format
  without updating the test
- "Cannot find element by..." → Claude changed a component's
  structure but the test still looks for the old structure
- "TypeError: X is not a function" → Claude removed or renamed
  something the test depends on
- Snapshot failures → Claude changed the UI and snapshots are
  outdated. Usually "update snapshots" is the fix.

GUIDANCE APPROACH:
- If 1-2 tests fail: suggest fixing them specifically
- If many tests fail: Claude probably made a structural change.
  Suggest re-running after fixing the first failure.
- If ALL tests fail: possible environment issue. Check imports.
- Never suggest deleting tests to make them pass.
