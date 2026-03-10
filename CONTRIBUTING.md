# Contributing to CodeMantis

Welcome, and thank you for your interest in contributing to CodeMantis! This project is maintained by CodeMantis, and we appreciate contributions of all kinds -- bug reports, feature suggestions, documentation improvements, and code.

## Prerequisites

Before you begin, make sure you have the following installed:

- **macOS** (CodeMantis is a native macOS application)
- **Node.js** (LTS version)
- **pnpm** (package manager)
- **Rust and Cargo** (latest stable toolchain via [rustup](https://rustup.rs))
- **Claude Code CLI** (installed and authenticated with a Claude Pro/Max subscription)

## Getting Started

1. Fork the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/codemantis.git
   cd codemantis
   ```

2. Install frontend dependencies:

   ```bash
   pnpm install
   ```

3. Start the development server:

   ```bash
   pnpm tauri dev
   ```

   This launches both the Vite dev server (frontend) and the Tauri Rust backend with hot-reload enabled.

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm tauri dev` | Run the full app in development mode |
| `pnpm dev` | Run the frontend only (useful for UI work) |
| `pnpm lint` | Lint the frontend codebase |
| `pnpm tsc --noEmit` | Type-check TypeScript without emitting files |
| `pnpm test` | Run frontend tests |
| `cargo test` | Run Rust backend tests (execute from `src-tauri/`) |

## Project Structure

```
codemantis/
  src/            # React frontend (TypeScript, Tailwind CSS)
  src-tauri/      # Rust backend (Tauri v2, process management, persistence)
  docs/           # Specifications and design documents
```

- **`src/`** -- React components, hooks, stores (Zustand), and type definitions.
- **`src-tauri/`** -- Rust modules for CLI process spawning, NDJSON parsing, IPC commands, and SQLite persistence.
- **`docs/`** -- Product specs, architecture notes, and reference material.

## Code Standards

All contributions must follow the project's coding standards:

### TypeScript / React

- TypeScript strict mode is enabled. Do not use `any` types.
- Provide explicit return types on all exported functions.
- Use functional components only. Use hooks for all state and effects.
- Use Zustand for global state management (no Redux, no Context API for global state).

### Rust

- Handle all `Result` values properly. Do not use `.unwrap()` in production code.
- Use `thiserror` for custom error types.
- All Tauri IPC commands must be async.

### Styling

- Use Tailwind CSS classes exclusively. No custom CSS files (except CSS variables in `index.css`).

### Naming Conventions

- **TypeScript / JavaScript:** `camelCase` for variables and functions
- **Rust:** `snake_case` for variables and functions
- **React Components:** `PascalCase`

## File Organization

- **One React component per file**, using a default export.
- **One Rust module per file**, re-exported from `mod.rs`.
- **Types** belong in dedicated files inside a `types/` directory.
- **No barrel exports** -- import directly from the source file rather than through an `index.ts`.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**, keeping commits focused and well-described.

3. **Verify your work** before opening a PR:

   ```bash
   pnpm tsc --noEmit   # Must pass with no errors
   pnpm lint            # Fix any lint warnings
   pnpm test            # All tests must pass
   cd src-tauri && cargo test  # All Rust tests must pass
   ```

4. **Open a pull request** against `main` with a clear description of what you changed and why.

5. Respond to review feedback promptly. We aim to review PRs within a few days.

## Versioning

CodeMantis uses semantic versioning (`major.minor.patch`). If your contribution changes functionality, you must bump the version in **all three** locations:

- `package.json` -- the `"version"` field
- `src-tauri/Cargo.toml` -- the `version` field
- `src-tauri/tauri.conf.json` -- the `"version"` field

Additionally, add an entry to `RELEASES.md` describing your changes with a bullet list.

Use patch bumps for fixes, minor bumps for new features, and major bumps for breaking changes.

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub. Include steps to reproduce the problem and any relevant log output.

## License

By contributing to CodeMantis, you agree that your contributions will be licensed under the [MIT License](LICENSE).
