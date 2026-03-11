# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from the Next.js Boilerplate (ixartz) on {{DATE}}.

## Architecture

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 4 with PostCSS
- **Database:** Drizzle ORM with PGlite (local, no external DB needed for dev)
- **Authentication:** Clerk (configure in Clerk Dashboard)
- **Monitoring:** Sentry for error tracking
- **Testing:** Vitest (unit) + Playwright (e2e) + Storybook (component)

## Project Structure

- `src/app/` — Next.js App Router pages and layouts
- `src/components/` — Reusable React components
- `src/libs/` — Third-party library configurations
- `src/locales/` — Internationalization locale files (next-intl)
- `src/models/Schema.ts` — Drizzle database schema
- `src/templates/` — Page templates
- `src/types/` — TypeScript type definitions
- `src/utils/` — Utility functions
- `src/validations/` — Zod validation schemas
- `migrations/` — Database migration files
- `tests/e2e/` — Playwright end-to-end tests
- `tests/integration/` — Integration tests

## Commands

- `npm run dev` — Start development server (http://localhost:3000)
- `npm run build` — Production build (runs migrations automatically)
- `npm run start` — Start production server
- `npm run test` — Run Vitest unit tests
- `npm run test:e2e` — Run Playwright tests
- `npm run storybook` — Start Storybook (http://localhost:6006)
- `npm run lint` — Run ESLint
- `npm run format` — Run Prettier

## Database

- Schema defined in `src/models/Schema.ts` using Drizzle ORM
- Generate migration: `npm run db:generate`
- Apply migration: `npm run db:migrate`
- Explore database: `npm run db:studio` (opens Drizzle Studio)
- Uses PGlite locally — no PostgreSQL installation needed for development

## Conventions

- Use App Router conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`
- Commits: follow Conventional Commits (Commitlint + Husky enforced)
- Use Zod schemas in `src/validations/` for all form/API validation
- Internationalization: all user-facing strings via next-intl, not hardcoded
- No `any` types. Strict TypeScript throughout.
