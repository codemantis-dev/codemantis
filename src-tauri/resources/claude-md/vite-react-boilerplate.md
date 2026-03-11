# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from the Vite React Boilerplate template on {{DATE}}.

## Architecture

- **Framework:** Vite + React 19 with TypeScript (strict mode)
- **Routing:** TanStack Router (file-based routes in `src/routes/`)
- **State:** Zustand for global state, TanStack Query for server state
- **Styling:** Tailwind CSS with PostCSS
- **Data visualization:** Nivo charts
- **Internationalization:** react-i18next (locale files in `src/locales/`)

## Project Structure

- `src/routes/` — File-based route definitions (TanStack Router)
- `src/components/` — Reusable UI components (one component per file)
- `src/stores/` — Zustand state stores
- `src/utils/` — Utility functions and helpers
- `src/types/` — TypeScript type definitions
- `src/test/` — Test utilities and setup

## Commands

- `pnpm dev` — Start development server with HMR
- `pnpm build` — Production build
- `pnpm test` — Run Vitest unit tests (watch mode)
- `pnpm test:e2e` — Run Playwright end-to-end tests
- `pnpm lint` — Run ESLint
- `pnpm format` — Run Prettier

## Conventions

- Components: functional only, one per file, default export
- Tests: colocated with source (e.g., `Button.test.tsx` next to `Button.tsx`)
- Commits: follow Conventional Commits (enforced by Commitlint + Husky)
- Imports: use absolute paths with `@/` prefix
- No `any` types. All functions must have explicit return types.
