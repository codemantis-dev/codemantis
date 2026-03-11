# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from the Next.js SaaS Boilerplate (ixartz) on {{DATE}}.

## Architecture

- **Framework:** Next.js with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** Drizzle ORM (PostgreSQL / SQLite / MySQL)
- **Authentication:** Clerk with multi-tenancy
- **Payments:** Stripe integration
- **Testing:** Vitest + Playwright
- **Internationalization:** next-intl

## Key SaaS Features

- Multi-tenancy with team/organization support
- Role-based permissions (Owner, Admin, Member)
- Stripe subscription billing (monthly/annual)
- User dashboard with settings
- User impersonation (admin feature)
- Landing page with pricing component
- Email templates

## Project Structure

- `src/app/(auth)/` — Authentication pages (sign-in, sign-up)
- `src/app/(marketing)/` — Landing page, pricing, blog
- `src/app/dashboard/` — User dashboard pages
- `src/models/Schema.ts` — Database schema
- `src/validations/` — Zod validation schemas

## Commands

- `npm run dev` — Start development server
- `npm run build` — Production build
- `npm run db:generate` — Generate migration from schema changes
- `npm run db:migrate` — Apply migrations
- `npm run db:studio` — Open Drizzle Studio
- `npm run test` — Run unit tests
- `npm run test:e2e` — Run end-to-end tests

## Conventions

- SaaS pages under `src/app/dashboard/`
- Marketing pages under `src/app/(marketing)/`
- All prices and plans configured in Stripe Dashboard, not hardcoded
- User-facing strings via next-intl for i18n
- Commits: Conventional Commits format
