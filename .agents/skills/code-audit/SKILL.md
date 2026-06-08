---
name: code-audit
description: >
  Comprehensive code quality audit & fix tool for Tauri + React + Rust codebases. Performs a
  two-phase workflow: (1) read-only audit across 9 categories with severity-scored findings,
  (2) grouped fixes with user confirmation. Covers security vulnerabilities, code duplication,
  type safety, component complexity, performance anti-patterns, test gaps, dead code, naming
  inconsistencies, and dependency health.
  Trigger keywords: code audit, code review, code quality, security audit, fix code smells,
  reduce duplication, open-source prep, refactor codebase, code cleanup, production readiness,
  audit codebase, code health, tech debt.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Edit
  - Write
  - Agent
---

# Code Audit — Comprehensive Quality & Security Audit + Fix

> Designed for Tauri v2 + React + TypeScript + Rust codebases. Works on any project following this stack.

## How to Use

**Input:** `$ARGUMENTS` controls scope. Accepted values:

| Argument | Effect |
|----------|--------|
| `all` (default) | Run all 9 audit categories |
| `security` | Security vulnerabilities only |
| `duplication` | Code duplication only |
| `types` | Type safety & error handling only |
| `complexity` | Component/module complexity only |
| `performance` | Performance anti-patterns only |
| `tests` | Test coverage gaps only |
| `dead-code` | Dead code & unused exports only |
| `naming` | Naming convention violations only |
| `dependencies` | Dependency health only |
| `rust` | All categories, Rust files only |
| `frontend` | All categories, frontend files only |
| `<path>` | All categories scoped to a specific file or directory |

If `$ARGUMENTS` is empty, treat as `all`.

---

## PHASE 1 — AUDIT (Read-Only)

**CRITICAL: Phase 1 is strictly read-only. Do NOT edit any files during this phase.**

### Step 1: Understand the Codebase

Before running any checks, orient yourself:

1. Read `AGENTS.md` (or equivalent project docs) to understand architecture rules
2. Read `package.json` for dependencies, scripts, and project metadata
3. Read `src-tauri/Cargo.toml` for Rust dependencies
4. Read `tsconfig.json` for TypeScript configuration
5. Identify the project structure by globbing key directories

Store these facts mentally — they inform severity ratings throughout.

### Step 2: Run Category Checklists

Run the applicable categories based on `$ARGUMENTS`. For each category, use the detection commands listed below. Record every finding with:
- **Severity:** CRITICAL / HIGH / MEDIUM / LOW
- **Location:** `file_path:line_number`
- **Description:** What's wrong and why it matters
- **Fix approach:** Concrete description of the fix

---

### Category 1: Security (Weight: 25/100)

**Severity guidance:** Injection/RCE = CRITICAL. Path traversal = CRITICAL. Secrets in code = CRITICAL. Missing input validation at boundaries = HIGH. Unsafe unwrap in server code = HIGH.

#### Checklist

- [ ] **Shell injection** — Commands built from user input passed to `sh -c` or `Command::new("sh")`
  ```
  Grep for: sh.*-c|Command::new.*sh|command_str|format!.*sh -c
  In: src-tauri/**/*.rs
  ```
  **Fix pattern:** Use `Command::new("<binary>").args(&[...])` instead of shell interpolation. Never pass unsanitized strings to `sh -c`.

- [ ] **Path traversal** — File operations using user-supplied filenames without validation
  ```
  Grep for: filename|file_name|path.*join.*name|write_all|create_dir
  In: src-tauri/**/*.rs
  Cross-reference with: any route/command that accepts a filename parameter
  ```
  **Fix pattern:** Validate filenames: reject if contains `..`, `/`, or `\`. Use `Path::file_name()` to extract just the filename component. Canonicalize and verify the result is within the expected directory.

- [ ] **Secrets in source** — API keys, tokens, passwords hardcoded in source
  ```
  Grep for: api_key|apikey|secret|password|token|bearer|private_key|AWS_|OPENAI_SK
  In: src/**/*.{ts,tsx}, src-tauri/**/*.rs
  Exclude: type definitions, config schemas, environment variable reads
  ```
  **Fix pattern:** Move to environment variables or secure storage. Add patterns to `.gitignore`.

- [ ] **Unsafe unwrap/expect** — `.unwrap()` or `.expect()` in production Rust code
  ```
  Grep for: \.unwrap\(\)|\.expect\(
  In: src-tauri/src/**/*.rs
  Exclude: tests, build scripts
  ```
  **Fix pattern:** Replace with `?` operator, `.unwrap_or_default()`, `.unwrap_or_else()`, or proper error handling with `thiserror`/`anyhow`.

- [ ] **Missing CORS / origin validation** — HTTP servers without origin checks
  ```
  Grep for: axum|actix|warp|rocket|hyper::Server
  In: src-tauri/**/*.rs
  Then check: are origins validated? Is binding restricted to 127.0.0.1?
  ```

- [ ] **SQL injection** — Raw string interpolation in SQL queries
  ```
  Grep for: format!.*SELECT|format!.*INSERT|format!.*UPDATE|format!.*DELETE
  In: src-tauri/**/*.rs
  ```
  **Fix pattern:** Use parameterized queries (`?` placeholders with rusqlite).

- [ ] **XSS via dangerouslySetInnerHTML**
  ```
  Grep for: dangerouslySetInnerHTML|innerHTML|v-html
  In: src/**/*.{tsx,jsx}
  ```
  **Fix pattern:** Sanitize with DOMPurify or use safe rendering alternatives.

- [ ] **Dependency vulnerabilities**
  ```
  Run: pnpm audit --json 2>/dev/null | head -100
  Run: cd src-tauri && cargo audit 2>/dev/null || echo "cargo-audit not installed"
  ```

---

### Category 2: Duplication (Weight: 15/100)

**Severity guidance:** Identical functions in multiple files = MEDIUM. Repeated 5+ line patterns in 3+ files = MEDIUM. Duplicated utility logic = LOW.

#### Checklist

- [ ] **Duplicate function definitions** — Same function name defined in multiple files
  ```
  Grep for: ^export (const|function) \w+
  In: src/**/*.{ts,tsx}
  Then: sort and find duplicates by function name
  ```
  **Fix pattern:** Extract to a shared utility file (e.g., `src/lib/formatters.ts`, `src/lib/file-utils.ts`). Re-export from barrel if needed.

- [ ] **Repeated inline patterns** — Same logic block appearing 3+ times
  Common patterns to check:
  ```
  Grep for: addEventListener.*mousedown|addEventListener.*click
  → Click-outside handlers: extract to useClickOutside hook

  Grep for: formatDuration|formatElapsed|formatTime|formatTokens|formatCost
  → Formatting utilities: consolidate into src/lib/formatters.ts

  Grep for: URL\.createObjectURL|createPreviewUrl|getObjectURL
  → URL creation: extract to src/lib/file-utils.ts
  ```

- [ ] **Duplicated Rust patterns**
  ```
  Grep for: fn \w+ in multiple command files with similar signatures
  In: src-tauri/src/commands/**/*.rs
  ```

- [ ] **Copy-pasted error handling** — Same error toast/notification pattern repeated
  ```
  Grep for: catch.*console\.(error|log)|\.catch\(|toast\.(error|warning)
  In: src/**/*.{ts,tsx}
  ```

---

### Category 3: Type Safety & Error Handling (Weight: 15/100)

**Severity guidance:** `any` in public APIs = HIGH. Disabled lint rules = MEDIUM. `console.error` as sole error handling = MEDIUM. Missing error boundaries = LOW.

#### Checklist

- [ ] **TypeScript `any` usage**
  ```
  Grep for: : any[^a-zA-Z]|as any|<any>
  In: src/**/*.{ts,tsx}
  Exclude: type definition files that legitimately need any
  ```
  **Fix pattern:** Replace with proper types. Use `unknown` + type narrowing if the type is truly dynamic.

- [ ] **eslint-disable comments**
  ```
  Grep for: eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck
  In: src/**/*.{ts,tsx}
  ```
  **Fix pattern:** Fix the underlying issue instead of suppressing. If suppression is truly needed, use `@ts-expect-error` with explanation comment.

- [ ] **console.error as error handling** — Catching errors but only logging them
  ```
  Grep for: catch.*\{[\s\S]*?console\.(error|log)[\s\S]*?\}
  In: src/**/*.{ts,tsx}
  Multiline search
  ```
  **Fix pattern:** Add proper error recovery — user-facing toast, retry logic, or graceful degradation.

- [ ] **Rust unwrap in non-test code** (overlaps with Security, but focus on type safety here)
  ```
  Grep for: \.unwrap\(\)
  In: src-tauri/src/**/*.rs
  Exclude: src-tauri/src/**/test*, #[cfg(test)]
  ```

- [ ] **Missing Result/Option handling**
  ```
  Grep for: let _ =|_\s*=.*\?
  In: src-tauri/src/**/*.rs
  ```
  **Fix pattern:** Handle the discarded Result/Option or explicitly comment why it's safe to ignore.

---

### Category 4: Complexity (Weight: 10/100)

**Severity guidance:** Files > 800 lines = HIGH. Files > 500 lines = MEDIUM. Functions > 100 lines = MEDIUM. Deeply nested callbacks (4+ levels) = MEDIUM.

#### Checklist

- [ ] **Large files** — Files exceeding reasonable size
  ```
  Run: find src -name "*.tsx" -o -name "*.ts" | xargs wc -l | sort -rn | head -20
  Run: find src-tauri/src -name "*.rs" | xargs wc -l | sort -rn | head -20
  ```
  **Fix pattern for components:** Extract sub-components. A 900-line component usually has 3-5 natural split points (rendering sections, modal content, list items).
  **Fix pattern for modules:** Extract related functions into sub-modules. Use `mod.rs` with `pub use` re-exports.

- [ ] **Long functions** — Functions exceeding 80-100 lines
  ```
  Use Agent to analyze the largest files for function length
  ```
  **Fix pattern:** Extract helper functions. Each function should do one thing.

- [ ] **Deep nesting** — Callback hell or deeply nested conditionals
  ```
  Grep for: ^\s{16,}(if|for|while|match|\.then|\.map)
  In: src/**/*.{ts,tsx}, src-tauri/**/*.rs
  ```
  **Fix pattern:** Early returns, extract functions, use `flatMap` over nested `map`, use Rust's `?` operator.

- [ ] **God components** — Components with too many responsibilities
  ```
  Check: Does the component manage its own state, fetch data, handle events, AND render complex UI?
  ```
  **Fix pattern:** Extract custom hooks for logic, sub-components for rendering sections.

---

### Category 5: Performance (Weight: 10/100)

**Severity guidance:** Missing keys in lists = HIGH. Expensive computation in render = MEDIUM. Missing memo on heavy components = LOW. Clone abuse in Rust = LOW.

#### Checklist

- [ ] **Missing React keys or using index as key**
  ```
  Grep for: \.map\(.*index.*\)[\s\S]*?key=\{.*index|key=\{i\}|key=\{idx\}
  In: src/**/*.tsx
  ```
  **Fix pattern:** Use a stable, unique identifier from the data (id, name, path).

- [ ] **Expensive computation in render path**
  ```
  Grep for: \.filter\(.*\.map\(|\.sort\(|\.reduce\(|JSON\.parse|JSON\.stringify
  In: src/**/*.tsx
  Check: Is this inside a component body (not in useMemo/useCallback)?
  ```
  **Fix pattern:** Wrap in `useMemo` with appropriate dependency array.

- [ ] **Missing useCallback on event handlers passed as props**
  ```
  Check large components: are inline arrow functions passed as props to child components?
  ```
  **Fix pattern:** Wrap handler in `useCallback`. Only worth fixing if the child is memoized or the parent re-renders frequently.

- [ ] **Rust clone abuse**
  ```
  Grep for: \.clone\(\)
  In: src-tauri/src/**/*.rs
  Count: if a file has 10+ clones, flag for review
  ```
  **Fix pattern:** Use references (`&str` instead of `String`), `Arc` for shared ownership, or restructure to avoid cloning.

- [ ] **Large bundle imports**
  ```
  Grep for: import.*from ['"]lodash['"]|import \* as|require\(['"]
  In: src/**/*.{ts,tsx}
  ```
  **Fix pattern:** Use specific imports (`import debounce from 'lodash/debounce'`) or native alternatives.

---

### Category 6: Tests (Weight: 10/100)

**Severity guidance:** No tests for critical business logic = HIGH. No tests for utility functions = MEDIUM. No tests for components = LOW. Incomplete test assertions = LOW.

#### Checklist

- [ ] **Untested stores**
  ```
  Glob: src/stores/*.ts
  Then check: does a corresponding test file exist in src/**/*.test.ts or src/**/*.spec.ts?
  ```

- [ ] **Untested hooks**
  ```
  Glob: src/hooks/*.ts
  Then check: test file existence
  ```

- [ ] **Untested utilities**
  ```
  Glob: src/lib/*.ts
  Then check: test file existence
  ```

- [ ] **Untested components** — Focus on components with logic, not pure presentational ones
  ```
  Glob: src/components/**/*.tsx
  Count: components without corresponding test files
  ```

- [ ] **Test quality** — Tests that don't actually assert behavior
  ```
  Grep for: expect\(true\)|\.toBeTruthy\(\)$|test\(.*\(\) => \{\s*\}\)
  In: src/**/*.test.{ts,tsx}
  ```

- [ ] **Rust test coverage**
  ```
  Grep for: #\[cfg\(test\)\]|#\[test\]
  In: src-tauri/src/**/*.rs
  Compare: which modules have tests vs which don't
  ```

---

### Category 7: Dead Code (Weight: 5/100)

**Severity guidance:** Entire unused files = MEDIUM. Unused exports = LOW. Commented-out code blocks = LOW. Stale imports = LOW.

#### Checklist

- [ ] **Unused exports**
  ```
  For each exported function/type in src/lib/*.ts and src/types/*.ts:
  Grep for its usage across the codebase. If only the definition exists, it's dead.
  ```

- [ ] **Commented-out code blocks** — Large commented sections (5+ lines)
  ```
  Grep for: ^\s*//.*\{|^\s*//.*function|^\s*//.*const|^\s*//.*import
  In: src/**/*.{ts,tsx}
  Use multiline to find blocks of consecutive comments that look like code
  ```
  **Fix pattern:** Delete. Git history preserves the code if needed later.

- [ ] **Stale imports**
  ```
  Run: pnpm tsc --noEmit 2>&1 | grep "declared but" | head -30
  ```
  **Fix pattern:** Remove unused imports.

- [ ] **Unused Rust dependencies**
  ```
  Run: cd src-tauri && cargo udeps 2>/dev/null || echo "cargo-udeps not installed"
  Fallback: manually check Cargo.toml dependencies against actual use
  ```

- [ ] **Orphaned files** — Files not imported by anything
  ```
  For each file in src/components, src/hooks, src/lib:
  Grep for its filename (without extension) in import statements
  ```

---

### Category 8: Naming (Weight: 5/100)

**Severity guidance:** Inconsistent casing = LOW. Missing boolean prefixes = LOW. Unclear abbreviations = LOW.

#### Checklist

- [ ] **TypeScript/JavaScript naming**
  ```
  - Components: must be PascalCase (grep for: export default function [a-z])
  - Variables/functions: must be camelCase
  - Constants: UPPER_SNAKE_CASE for true constants, camelCase for derived values
  - Boolean variables: should use is/has/should/can prefix
  - Event handlers: should use handle prefix (handleClick, handleSubmit)
  ```

- [ ] **Rust naming**
  ```
  - Functions/variables: must be snake_case
  - Types/structs/enums: must be PascalCase
  - Constants: must be UPPER_SNAKE_CASE
  Grep for: fn [A-Z]|let [A-Z]|struct [a-z]|enum [a-z]
  In: src-tauri/src/**/*.rs
  ```

- [ ] **File naming**
  ```
  - React components: PascalCase.tsx
  - Hooks: camelCase starting with "use" (useXxx.ts)
  - Utilities: camelCase.ts
  - Rust modules: snake_case.rs
  Glob for violations in src/ and src-tauri/src/
  ```

- [ ] **Inconsistent naming for same concept**
  ```
  Grep for: session_id|sessionId|session\.id — are these used consistently within each language?
  Similar checks for: project_path/projectPath, file_path/filePath
  ```

---

### Category 9: Dependencies (Weight: 5/100)

**Severity guidance:** Known vulnerabilities = HIGH. Major version outdated (2+) = MEDIUM. Unused dependencies = LOW. Misplaced devDependencies = LOW.

#### Checklist

- [ ] **Outdated dependencies**
  ```
  Run: pnpm outdated 2>/dev/null | head -30
  Run: cd src-tauri && cargo outdated 2>/dev/null || echo "cargo-outdated not installed"
  ```

- [ ] **Unused npm dependencies**
  ```
  For each dependency in package.json:
  Grep for its package name in import/require statements
  If not found, flag as potentially unused
  ```

- [ ] **Misplaced devDependencies** — Build tools in dependencies, or runtime deps in devDependencies
  ```
  Read package.json: check if @types/* packages are in dependencies (should be devDependencies)
  Check if runtime-required packages are in devDependencies
  ```

- [ ] **Duplicate/overlapping dependencies**
  ```
  Check for: multiple date libraries, multiple HTTP clients, multiple state management, multiple CSS solutions
  ```

- [ ] **License compatibility**
  ```
  Run: pnpm licenses list 2>/dev/null | grep -E "GPL|AGPL|SSPL" | head -10
  ```
  **Fix pattern:** Replace GPL-incompatible dependencies if the project uses MIT/Apache.

---

### Step 3: Calculate Score & Generate Report

#### Scoring Formula

Each category starts at its maximum weight. Deduct points per finding:
- CRITICAL: -5 points (capped at category weight)
- HIGH: -3 points
- MEDIUM: -1 point
- LOW: -0.5 points

Minimum score per category is 0. Overall score = sum of all category scores.

#### Score Interpretation

| Score | Rating | Meaning |
|-------|--------|---------|
| 90-100 | A+ | Excellent — production ready, minor polish only |
| 80-89 | A | Good — few issues, safe for open-source |
| 70-79 | B | Acceptable — some issues to address before release |
| 60-69 | C | Needs work — significant issues in multiple areas |
| 50-59 | D | Poor — critical issues must be resolved |
| < 50 | F | Failing — major rework needed |

### Report Template

Present the audit report in this exact format:

```markdown
# Code Audit Report

**Date:** YYYY-MM-DD
**Scope:** [scope from $ARGUMENTS]
**Overall Score:** XX/100 (Rating)

## Score Breakdown

| Category | Score | Max | Findings |
|----------|-------|-----|----------|
| Security | XX | 25 | X critical, X high, X medium, X low |
| Duplication | XX | 15 | ... |
| Type Safety | XX | 15 | ... |
| Complexity | XX | 10 | ... |
| Performance | XX | 10 | ... |
| Tests | XX | 10 | ... |
| Dead Code | XX | 5 | ... |
| Naming | XX | 5 | ... |
| Dependencies | XX | 5 | ... |

## CRITICAL Findings

### [CRITICAL-1] Title
- **File:** `path/to/file.rs:123`
- **Issue:** Description of the vulnerability/problem
- **Impact:** What could go wrong
- **Fix:** Concrete fix approach with code snippet

### [CRITICAL-2] ...

## HIGH Findings

### [HIGH-1] Title
...

## MEDIUM Findings

### [MEDIUM-1] Title
...

## LOW Findings

### [LOW-1] Title
...

## Recommended Fix Order
1. All CRITICAL findings (security first)
2. HIGH findings by impact
3. MEDIUM findings grouped by category for efficient batch fixing
4. LOW findings as time permits
```

**After presenting the report, STOP and ask the user:**
> "Audit complete. Would you like me to proceed with fixes? You can say:
> - `fix all` — fix everything in recommended order
> - `fix critical` — fix only CRITICAL findings
> - `fix <category>` — fix a specific category (e.g., `fix security`)
> - `fix HIGH+` — fix CRITICAL and HIGH only
> - Or specify individual finding IDs (e.g., `fix CRITICAL-1, HIGH-3`)"

---

## PHASE 2 — FIX (With Confirmation)

**CRITICAL: Always get user confirmation before starting fixes.**

### Fix Workflow

For each fix group (based on user's selection):

1. **Announce the group:** "Fixing [category]: [N] findings"
2. **For each finding in the group:**
   a. Read the affected file(s)
   b. Show the planned change (brief description)
   c. Apply the fix using Edit (prefer) or Write (for new files only)
   d. If the fix involves extracting code to a new file, also update all import sites
3. **After each group:** Run verification (see below)

### Fix Patterns by Category

#### Security Fixes

**Shell injection → Safe command execution:**
```rust
// BEFORE (vulnerable)
let output = Command::new("sh")
    .arg("-c")
    .arg(&command_str) // user-controlled!
    .output()?;

// AFTER (safe)
let output = Command::new("program_name")
    .args(&["arg1", "arg2"])
    .current_dir(&working_dir)
    .output()?;
```

**Path traversal → Filename validation:**
```rust
// BEFORE (vulnerable)
let dest = upload_dir.join(&filename);

// AFTER (safe)
let safe_name = Path::new(&filename)
    .file_name()
    .ok_or_else(|| anyhow!("Invalid filename"))?;
// Reject names with path separators or traversal
let name_str = safe_name.to_str().ok_or_else(|| anyhow!("Non-UTF8 filename"))?;
if name_str.contains("..") || name_str.contains('/') || name_str.contains('\\') {
    return Err(anyhow!("Invalid filename characters"));
}
let dest = upload_dir.join(safe_name);
```

**Unsafe unwrap → Proper error handling:**
```rust
// BEFORE
let addr = listener.local_addr().unwrap();

// AFTER
let addr = listener.local_addr()
    .map_err(|e| format!("Failed to get server address: {}", e))?;
```

#### Duplication Fixes

**Extract shared utility:**
1. Create or append to the appropriate utility file (`src/lib/formatters.ts`, `src/lib/file-utils.ts`, etc.)
2. Move the canonical implementation there with proper types and JSDoc
3. Update all call sites to import from the new location
4. Verify no circular dependencies introduced

**Extract custom hook:**
1. Create `src/hooks/useXxx.ts`
2. Move the repeated logic into the hook
3. Update all components to use the hook
4. Add a basic test for the hook

#### Complexity Fixes

**Split large component (>500 lines):**
1. Identify natural boundaries (sections of JSX, modal content, list items)
2. Create sub-components in the same directory or a subdirectory
3. Move JSX + related handlers to sub-components
4. Pass data via props (prefer minimal props over passing everything)
5. Keep state management in the parent unless it's section-specific

**Split large Rust module (>500 lines):**
1. Identify cohesive function groups
2. Create sub-modules in a directory (`mod.rs` pattern)
3. Use `pub use` re-exports to maintain the public API

#### Test Fixes

**Add tests for untested utility:**
```typescript
// src/lib/__tests__/utility-name.test.ts
import { describe, it, expect } from 'vitest';
import { functionName } from '../utility-name';

describe('functionName', () => {
  it('handles normal input', () => {
    expect(functionName(input)).toBe(expected);
  });

  it('handles edge case', () => {
    expect(functionName(edgeInput)).toBe(edgeExpected);
  });
});
```

**Add tests for untested store:**
```typescript
// src/stores/__tests__/storeName.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoreName } from '../storeName';

describe('storeName', () => {
  beforeEach(() => {
    useStoreName.setState(initialState);
  });

  it('action does expected thing', () => {
    useStoreName.getState().action(args);
    expect(useStoreName.getState().property).toBe(expected);
  });
});
```

### Verification

After completing all fixes in a group, run:

```bash
# TypeScript compilation
pnpm tsc --noEmit

# Linting
pnpm lint

# Frontend tests
pnpm test

# Rust checks
cd src-tauri && cargo check && cargo test
```

**All must pass.** If any fail:
1. Read the error output
2. Fix the issue (usually an import path or type error from refactoring)
3. Re-run the failing check
4. Do not proceed to the next fix group until all checks pass

### Commit Strategy

Create atomic commits per fix category using conventional commit prefixes:

| Category | Prefix | Example |
|----------|--------|---------|
| Security | `fix(security):` | `fix(security): sanitize shell command arguments in scaffold` |
| Duplication | `refactor:` | `refactor: extract shared formatters to lib/formatters.ts` |
| Type Safety | `fix:` | `fix: replace any types with proper interfaces` |
| Complexity | `refactor:` | `refactor: split AssistantPanel into sub-components` |
| Performance | `perf:` | `perf: memoize expensive filter chains in ActivityFeed` |
| Tests | `test:` | `test: add tests for settingsStore and toastStore` |
| Dead Code | `chore:` | `chore: remove unused exports and commented code` |
| Naming | `refactor:` | `refactor: fix naming convention violations` |
| Dependencies | `chore(deps):` | `chore(deps): remove unused dependencies` |

**Do NOT commit without asking the user first.** Present a summary of changes and the proposed commit message, then ask for confirmation.

---

## Rules

1. **Never skip user confirmation** before applying fixes — always present the plan and wait
2. **Follow existing architecture** — don't restructure the project; work within established patterns
3. **Preserve behavior** — refactoring must not change functionality; verify with tests
4. **Test what you fix** — if you extract a utility, add tests for it
5. **Keep fixes minimal** — solve the identified problem, don't gold-plate or add extras
6. **Every finding needs file:line** — vague findings without locations are useless
7. **Don't break imports** — when moving code, update ALL import sites; verify with `pnpm tsc --noEmit`
8. **Respect .gitignore** — don't audit generated files, node_modules, target/, dist/
9. **Use Edit over Write** — prefer surgical edits to full file rewrites
10. **One concern per commit** — don't mix security fixes with formatting changes
