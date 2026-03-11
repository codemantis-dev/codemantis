# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from next-forge (monorepo) on {{DATE}}.

## Architecture

- **Framework:** Next.js with App Router (Turborepo monorepo)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + Radix UI
- **Database:** Prisma ORM
- **Authentication:** Clerk
- **Payments:** Stripe
- **Monorepo:** Turborepo for multi-app workspace
- **Testing:** Vitest + Playwright
- **Monitoring:** Sentry

## Monorepo Structure

- `apps/web/` — Main Next.js web application
- `apps/api/` — API application
- `packages/ui/` — Shared UI component library
- `packages/config/` — Shared configuration (ESLint, TypeScript, Tailwind)
- `packages/database/` — Prisma schema and client

## Commands

- `pnpm dev` — Start all apps in development mode
- `pnpm build` — Build all apps
- `pnpm lint` — Lint all packages
- `pnpm test` — Run tests across all packages
- `pnpm db:push` — Push Prisma schema to database
- `pnpm db:studio` — Open Prisma Studio

## Conventions

- Shared components go in `packages/ui/`, app-specific in `apps/web/src/components/`
- Database changes: edit `packages/database/prisma/schema.prisma`, then `pnpm db:push`
- Environment variables: `.env.local` in each app directory
- Cross-package imports use workspace protocol (e.g., `@repo/ui`)
