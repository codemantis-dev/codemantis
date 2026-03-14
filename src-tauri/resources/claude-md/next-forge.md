# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from next-forge (monorepo) on {{DATE}}.

## Architecture

- **Framework:** Next.js with App Router (Turborepo monorepo)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **Database:** Prisma ORM
- **Authentication:** Clerk
- **Payments:** Stripe
- **Monorepo:** Turborepo for multi-app workspace
- **Linting:** Biome
- **Monitoring:** Sentry
- **Docs:** Mintlify

## Monorepo Structure

- `apps/web/` — Main Next.js web application
- `apps/api/` — API application
- `apps/docs/` — Mintlify documentation site
- `apps/email/` — Email templates
- `apps/storybook/` — Component storybook
- `apps/studio/` — Prisma Studio
- `packages/database/` — Prisma schema and generated client
- `packages/` — Shared configuration and utilities

## Commands

- `pnpm dev` — Start all apps in development mode
- `pnpm build` — Build all apps
- `pnpm lint` — Lint all packages (Biome)
- `pnpm db:push` — Push Prisma schema to database
- `pnpm db:studio` — Open Prisma Studio

## Conventions

- Cross-package imports use workspace protocol (e.g., `@repo/database`)
- Database changes: edit `packages/database/prisma/schema.prisma`, then `pnpm db:push`
- Environment variables: `.env.local` in each app directory
