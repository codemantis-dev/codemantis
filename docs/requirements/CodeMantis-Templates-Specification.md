# CodeMantis — Project Templates Feature Specification

**Version:** 1.0
**Purpose:** Add a "Start from Template" feature to CodeMantis that scaffolds new projects from curated, high-quality GitHub templates and auto-generates an AI-optimized CLAUDE.md for each.

---

## 1. Feature Overview

When a user creates a new project in CodeMantis, they can optionally choose from a curated set of project templates. The app clones the template, removes git history, installs dependencies, drops in a CLAUDE.md file tailored to the template's stack, and opens the project as a new session. The user is immediately ready to build with Claude Code in a properly structured codebase.

This is commonly called **project scaffolding** (like `create-next-app`, `create-vite`, or Lovable.dev's project generator).

---

## 2. User Flow

```
1. User clicks "New Project" (or "+") in the session tabs
2. ProjectPicker modal opens (existing behavior)
3. NEW: A "Start from Template" tab appears alongside "Open Folder" and "Recent Projects"
4. User sees a grid of template cards, organized by category
5. User clicks a template card → card expands or modal transitions to detail view
6. Detail view shows: full description, tech stack tags, screenshot/preview, "Use Template" button
7. User clicks "Use Template" → native folder dialog opens to choose a parent directory
8. User enters a project name (defaults to template name)
9. Progress indicator: "Cloning template..." → "Installing dependencies..." → "Setting up CLAUDE.md..."
10. Project opens as a new CodeMantis session with the Activity feed showing setup steps
```

---

## 3. Template Registry

### 3.1 Registry Format

A JSON file that ships with the app and can optionally be updated from a remote URL.

**Location in repo:** `src-tauri/resources/templates.json`

**Also available remotely at:** `https://raw.githubusercontent.com/<org>/templates/main/registry.json`

**Schema:**

```json
{
  "version": 1,
  "updated_at": "2026-03-10",
  "templates": [
    {
      "id": "nextjs-boilerplate",
      "name": "Next.js Full-Stack",
      "description": "Production-ready Next.js 16 with TypeScript, Tailwind CSS 4, Drizzle ORM, Auth, Testing, and CI/CD. The most popular Next.js starter on GitHub.",
      "long_description": "Complete developer experience with ESLint, Prettier, Husky, Commitlint, Vitest, Playwright, and Storybook. Includes local PGlite database — no external DB needed for development. Auth via Clerk. Monthly dependency updates.",
      "category": "full-stack",
      "tags": ["next.js", "react", "typescript", "tailwind", "drizzle", "clerk", "vitest", "playwright"],
      "repo_url": "https://github.com/ixartz/Next-js-Boilerplate",
      "branch": "main",
      "stars": 12700,
      "license": "MIT",
      "install_command": "npm install",
      "dev_command": "npm run dev",
      "dev_port": 3000,
      "post_clone_cleanup": [".git", "LICENSE"],
      "icon": "nextjs",
      "verified": true,
      "last_verified": "2026-03-10"
    }
  ]
}
```

### 3.2 Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier, used for CLAUDE.md lookup |
| `name` | string | yes | Display name in the template picker |
| `description` | string | yes | One-line description (shown on card) |
| `long_description` | string | no | Extended description (shown in detail view) |
| `category` | string | yes | One of: `frontend`, `full-stack`, `backend`, `mobile`, `static`, `ai` |
| `tags` | string[] | yes | Tech stack tags for filtering |
| `repo_url` | string | yes | GitHub HTTPS clone URL |
| `branch` | string | yes | Branch to clone (usually `main`) |
| `stars` | number | no | GitHub stars (for display, updated periodically) |
| `license` | string | yes | License type (only include MIT/Apache/ISC templates) |
| `install_command` | string | yes | Command to install dependencies |
| `dev_command` | string | yes | Command to start dev server |
| `dev_port` | number | no | Port the dev server runs on |
| `post_clone_cleanup` | string[] | no | Files/dirs to remove after clone (e.g., original LICENSE) |
| `icon` | string | yes | Icon identifier for the template card |
| `verified` | boolean | yes | Whether we've verified the template works |
| `last_verified` | string | yes | ISO date when we last tested this template |

---

## 4. Verified Template List

Below are the templates that passed quality review. Each has been evaluated for: active maintenance (commits in last 3 months), meaningful star count, MIT/Apache license, clean project structure, working build, and up-to-date dependencies.

### 4.1 Frontend

#### React + Vite (Batteries Included)
- **Repo:** `github.com/RicardoValdovinos/vite-react-boilerplate`
- **Stars:** ~700 | **License:** MIT | **Last updated:** Monthly (confirmed May 2025+)
- **Stack:** Vite 7, React 19, TypeScript, Tailwind, TanStack Router + Query + Table, Vitest, Playwright, Zustand, react-i18next, Nivo charts, Husky, Commitlint
- **Install:** `pnpm install` | **Dev:** `pnpm dev`
- **Quality notes:** Clean architecture following bulletproof-react patterns. No demo cruft — minimal glue code. Monthly dependency updates committed by maintainer. Excellent documentation. One of the best Vite+React starters.
- **VERDICT: ✅ INCLUDE**

#### React + Vite (Minimal with shadcn/ui)
- **Repo:** Generated via CLI commands (not a repo clone)
- **Commands:** `pnpm create vite <name> --template react-ts` then `pnpm dlx shadcn@latest init`
- **Stack:** Vite, React, TypeScript, Tailwind, shadcn/ui
- **Quality notes:** This is the official Vite scaffolding + shadcn. Always up to date because it's generated from the latest CLI versions. This is closest to what Lovable.dev outputs.
- **VERDICT: ✅ INCLUDE (as a "generated" template using CLI commands instead of git clone)**

### 4.2 Full-Stack (Next.js)

#### Next.js Boilerplate (ixartz)
- **Repo:** `github.com/ixartz/Next-js-Boilerplate`
- **Stars:** 12,700+ | **License:** MIT | **Last updated:** October 2025 (monthly releases)
- **Stack:** Next.js 16, TypeScript, Tailwind CSS 4, Drizzle ORM, PGlite, Clerk Auth, ESLint, Prettier, Husky, Vitest, Playwright, Storybook, Sentry, Commitlint
- **Install:** `npm install` | **Dev:** `npm run dev`
- **Quality notes:** The gold standard. Most-starred Next.js boilerplate on GitHub. Updated monthly. Dependencies pinned to latest majors. Local PGlite database means zero external setup. Excellent project structure. Rated 9/10 by DesignRevision's 2026 template review.
- **VERDICT: ✅ INCLUDE (flagship template)**

#### Next.js SaaS Boilerplate (ixartz)
- **Repo:** `github.com/ixartz/SaaS-Boilerplate`
- **Stars:** ~3,000 | **License:** MIT | **Last updated:** Active
- **Stack:** Next.js, TypeScript, Tailwind, shadcn/ui, Drizzle ORM, Clerk Auth, Stripe, Multi-tenancy, i18n, Vitest, Playwright
- **Install:** `npm install` | **Dev:** `npm run dev`
- **Quality notes:** Same maintainer as the flagship boilerplate. Adds SaaS essentials: Stripe payments, multi-tenancy, team management, roles/permissions, user impersonation. Has a free tier and a Pro tier — the free version is fully functional.
- **VERDICT: ✅ INCLUDE**

#### next-forge (Monorepo)
- **Repo:** `github.com/haydenbleasel/next-forge`
- **Stars:** ~5,000+ | **License:** MIT | **Last updated:** Active
- **Stack:** Next.js, TypeScript, Tailwind, Radix UI, Prisma, Clerk, Turborepo, Vitest, Playwright, Sentry, Stripe
- **Install:** `pnpm install` | **Dev:** `pnpm dev`
- **Quality notes:** Monorepo architecture using Turborepo. Separates apps, packages, and API. Production-ready with testing, error monitoring, and deployment pre-configured. Good for larger projects that need multi-app structure. Well-documented.
- **VERDICT: ✅ INCLUDE**

### 4.3 Full-Stack (Python Backend)

#### FastAPI Full-Stack (Official by Tiangolo)
- **Repo:** `github.com/fastapi/full-stack-fastapi-template`
- **Stars:** 30,000+ | **License:** MIT | **Last updated:** Active
- **Stack:** FastAPI, React, SQLModel, PostgreSQL, Docker, GitHub Actions, Traefik, automatic HTTPS
- **Install:** Uses Copier (`pipx run copier copy`) | **Dev:** `docker compose up`
- **Quality notes:** The reference full-stack FastAPI template, maintained by the FastAPI creator. Uses Copier for templating (asks interactive questions during setup). Docker-based dev environment. PostgreSQL required. More opinionated but extremely well-tested.
- **Special handling:** Requires Docker. The install flow is different (Copier, not git clone). Needs a custom scaffold step.
- **VERDICT: ✅ INCLUDE (with Docker prerequisite warning)**

#### FastAPI Boilerplate (benavlabs)
- **Repo:** `github.com/benavlabs/FastAPI-boilerplate`
- **Stars:** ~10,000+ | **License:** MIT | **Last updated:** Active (Discord community, regular releases)
- **Stack:** FastAPI, SQLAlchemy 2.0, Pydantic V2, PostgreSQL, Redis, ARQ job queues, Docker, NGINX
- **Install:** `uv sync` | **Dev:** `uv run uvicorn src.app.main:app --reload`
- **Quality notes:** Production-proven (multiple apps running in production from this base). Excellent documentation site. Active Discord community. Rate limiting, background jobs, tiered users out of the box. Uses modern `uv` package manager.
- **VERDICT: ✅ INCLUDE**

### 4.4 Static / Content Sites

#### Astro (Official)
- **Repo:** Generated via CLI
- **Command:** `pnpm create astro@latest`
- **Stack:** Astro, TypeScript, Tailwind (optional during setup)
- **Quality notes:** Official Astro scaffolding. Always latest version. Interactive setup asks about TypeScript, Tailwind, and template preference. Blazing fast for content sites, blogs, documentation, and marketing pages.
- **VERDICT: ✅ INCLUDE (as a CLI-generated template)**

### 4.5 Mobile

#### Expo + React Native (Official)
- **Repo:** Generated via CLI
- **Command:** `npx create-expo-app@latest`
- **Stack:** Expo, React Native, TypeScript
- **Quality notes:** Official Expo scaffolding. The standard way to start cross-platform mobile apps. Always latest SDK.
- **VERDICT: ✅ INCLUDE (as a CLI-generated template)**

### 4.6 REJECTED Templates (with reasons)

| Template | Reason for rejection |
|----------|---------------------|
| `CriticalMoments/CMSaasStarter` | SvelteKit, not React/Next.js — too niche for initial launch |
| `moinulmoin/chadnext` | Lower star count (~2K), Lucia Auth is being deprecated in favor of Better Auth |
| `hcp-uw/react-fastapi-starter-template` | Educational project, not production-ready |
| `honojs/starter` | Too minimal, more of a framework demo than a project scaffold |
| `langchain-ai/langchain-nextjs-template` | Niche (LLM-specific), better as a future addition under "AI" category |

---

## 5. Scaffold Engine (Rust Backend)

### 5.1 New Tauri Commands

Add to `src-tauri/src/commands/scaffold.rs`:

```rust
#[tauri::command]
pub async fn list_templates() -> Result<Vec<TemplateEntry>, String>
// Returns the parsed template registry (from bundled JSON, or cached remote fetch)

#[tauri::command]
pub async fn scaffold_from_template(
    template_id: String,
    project_path: String,     // Parent directory chosen by user
    project_name: String,     // User-entered project name
) -> Result<ScaffoldResult, String>
// Executes the full scaffold pipeline (see 5.2)

#[tauri::command]
pub async fn scaffold_from_cli(
    cli_command: String,       // e.g., "pnpm create vite"
    project_path: String,
    project_name: String,
    post_commands: Vec<String>, // e.g., ["pnpm dlx shadcn@latest init"]
) -> Result<ScaffoldResult, String>
// For CLI-generated templates (Vite, Astro, Expo)

#[tauri::command]
pub async fn refresh_template_registry() -> Result<(), String>
// Fetches latest registry.json from remote URL and caches locally
```

### 5.2 Scaffold Pipeline (for git-clone templates)

Execute these steps in order. Emit progress events to the frontend after each step.

```
Step 1: VALIDATE
  - Check git is installed (which git)
  - Check target directory exists and is writable
  - Check project_name doesn't contain invalid characters
  - Check target_dir/project_name doesn't already exist
  → Emit: scaffold-progress { step: "validate", status: "done" }

Step 2: CLONE
  - git clone --depth 1 --branch <branch> <repo_url> <target_dir>/<project_name>
  - This does a shallow clone (no full history, saves time and bandwidth)
  → Emit: scaffold-progress { step: "clone", status: "done" }

Step 3: CLEAN
  - Remove .git directory (rm -rf .git)
  - Remove files listed in post_clone_cleanup (e.g., original LICENSE)
  - Initialize fresh git repo: git init && git add -A && git commit -m "Initial scaffold from <template_name>"
  → Emit: scaffold-progress { step: "clean", status: "done" }

Step 4: INSTALL DEPENDENCIES
  - Run the template's install_command (e.g., "pnpm install" or "npm install")
  - Capture stdout/stderr for progress display
  - Timeout: 120 seconds (some installs are slow)
  → Emit: scaffold-progress { step: "install", status: "done" }

Step 5: WRITE CLAUDE.MD
  - Look up the CLAUDE.md content for this template_id
  - CLAUDE.md templates are stored in: src-tauri/resources/claude-md/<template_id>.md
  - Replace placeholders: {{PROJECT_NAME}} → project_name
  - Write to <project_dir>/CLAUDE.md
  → Emit: scaffold-progress { step: "claude_md", status: "done" }

Step 6: FINAL COMMIT
  - git add CLAUDE.md
  - git commit -m "Add CLAUDE.md for AI-assisted development"
  → Emit: scaffold-progress { step: "complete", status: "done" }
```

### 5.3 Scaffold Pipeline (for CLI-generated templates)

For templates that use framework CLIs (Vite, Astro, Expo), the flow is slightly different:

```
Step 1: VALIDATE (same as above)

Step 2: RUN CLI
  - Execute the cli_command in the target directory
  - For non-interactive CLIs, pass flags to skip prompts
  - Examples:
    - Vite: pnpm create vite <name> --template react-ts
    - Astro: pnpm create astro@latest <name> -- --template minimal --typescript strict
    - Expo: npx create-expo-app@latest <name> --template default
  → Emit: scaffold-progress { step: "generate", status: "done" }

Step 3: POST COMMANDS
  - Run any post_commands sequentially (e.g., "pnpm dlx shadcn@latest init --defaults")
  → Emit: scaffold-progress { step: "configure", status: "done" }

Steps 4-6: Same as git-clone pipeline (install, CLAUDE.md, commit)
```

### 5.4 Error Handling

- If any step fails, emit `scaffold-progress { step: "<step>", status: "error", error: "<message>" }`
- If clone fails (network error, repo not found), show clear error message
- If install fails, still write CLAUDE.md and open the project — user can fix install manually
- If git is not installed, show error with install instructions
- All steps run with a timeout to prevent hanging

---

## 6. Frontend Components

### 6.1 TemplatePicker Component

**Location:** `src/components/modals/TemplatePicker.tsx`

**Integration:** Add as a new tab in the existing `ProjectPicker.tsx` modal. The tab bar should show: "Open Folder" | "Recent" | "Templates"

**Layout:**
- Category filter bar at top: All | Frontend | Full-Stack | Backend | Mobile | Static
- Search input for filtering by name or tags
- Grid of template cards (2-3 columns depending on modal width)

### 6.2 TemplateCard Component

**Location:** `src/components/modals/TemplateCard.tsx`

**Each card shows:**
- Template icon (framework logo or generic icon from Lucide)
- Template name (bold)
- One-line description
- Tech stack tags (small pills: "Next.js", "TypeScript", "Tailwind", etc.)
- Star count badge (e.g., "12.7K ⭐")
- License badge ("MIT")

**On click:** Expands to detail view or navigates to a detail panel within the modal.

### 6.3 TemplateDetail Component

**Location:** `src/components/modals/TemplateDetail.tsx`

**Shows:**
- Full template name and description
- Long description (if available)
- Complete tag list
- "What's included" section (key features)
- Prerequisites (e.g., "Requires Docker" for FastAPI official template)
- "Use This Template" button (accent-colored, prominent)
- "View on GitHub" link (opens in system browser)

**"Use This Template" flow:**
1. Click button → native folder dialog opens (choose parent directory)
2. Input field for project name (pre-filled with template name, editable)
3. "Create Project" button → starts scaffold pipeline
4. Progress overlay shows each step with checkmarks

### 6.4 ScaffoldProgress Component

**Location:** `src/components/modals/ScaffoldProgress.tsx`

**Shows a step-by-step progress indicator:**
```
✅ Validating...
✅ Cloning template...
⏳ Installing dependencies...  (with spinner)
⬜ Setting up CLAUDE.md...
⬜ Finalizing...
```

Each step transitions from waiting → in progress (spinner) → done (checkmark) → or error (red ✗ with message).

On completion: "Project ready! [Open in CodeMantis]" button that creates a session for the new project.

---

## 7. CLAUDE.md Templates

### 7.1 Storage

Store in the app bundle: `src-tauri/resources/claude-md/`

One file per template, named `<template_id>.md`.

### 7.2 Placeholder Variables

CLAUDE.md templates can include these placeholders, replaced during scaffolding:

| Placeholder | Replaced with |
|-------------|---------------|
| `{{PROJECT_NAME}}` | User-entered project name |
| `{{TEMPLATE_NAME}}` | Template display name |
| `{{DATE}}` | Current date (ISO format) |

### 7.3 CLAUDE.md Template Files

Create all of the following files:

---

#### `src-tauri/resources/claude-md/vite-react-boilerplate.md`

```markdown
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
```

---

#### `src-tauri/resources/claude-md/vite-react-shadcn.md`

```markdown
# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded with Vite + React + shadcn/ui on {{DATE}}.

## Architecture

- **Framework:** Vite + React with TypeScript
- **UI Components:** shadcn/ui (Radix primitives + Tailwind)
- **Styling:** Tailwind CSS

## Project Structure

- `src/components/ui/` — shadcn/ui component library (auto-generated, customizable)
- `src/components/` — Application-specific components
- `src/lib/utils.ts` — Utility functions (includes `cn()` for class merging)
- `src/App.tsx` — Root component

## Commands

- `pnpm dev` — Start development server
- `pnpm build` — Production build
- `pnpm preview` — Preview production build locally
- `pnpm dlx shadcn@latest add <component>` — Add a new shadcn/ui component

## Conventions

- Use shadcn/ui components from `@/components/ui/` for all standard UI elements
- Use `cn()` from `@/lib/utils` for conditional class names
- Tailwind classes only — no custom CSS files
- TypeScript strict mode, no `any` types
```

---

#### `src-tauri/resources/claude-md/nextjs-boilerplate.md`

```markdown
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
```

---

#### `src-tauri/resources/claude-md/nextjs-saas.md`

```markdown
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
```

---

#### `src-tauri/resources/claude-md/next-forge.md`

```markdown
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
```

---

#### `src-tauri/resources/claude-md/fastapi-fullstack.md`

```markdown
# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from the Full-Stack FastAPI Template (by Tiangolo) on {{DATE}}.

## Architecture

- **Backend:** FastAPI with SQLModel ORM
- **Frontend:** React with TypeScript
- **Database:** PostgreSQL
- **Containerization:** Docker Compose for all services
- **Deployment:** Traefik reverse proxy, automatic HTTPS
- **CI/CD:** GitHub Actions

## Project Structure

- `backend/` — FastAPI application
  - `backend/app/` — Application code
  - `backend/app/api/` — API route handlers
  - `backend/app/models.py` — SQLModel database models
  - `backend/app/crud.py` — CRUD operations
- `frontend/` — React application
- `docker-compose.yml` — Service orchestration

## Commands

- `docker compose up` — Start all services (backend + frontend + DB)
- `docker compose down` — Stop all services
- `docker compose exec backend bash` — Shell into backend container

### Backend (inside container or with venv):
- `uvicorn app.main:app --reload` — Start backend dev server
- `alembic revision --autogenerate -m "description"` — Create migration
- `alembic upgrade head` — Apply migrations

### Frontend:
- `npm run dev` — Start frontend dev server

## Prerequisites

- Docker and Docker Compose must be installed
- No local Python or Node.js installation required (everything runs in containers)

## Conventions

- API endpoints in `backend/app/api/routes/`
- Database models use SQLModel (SQLAlchemy + Pydantic combined)
- All API routes return Pydantic models for type safety
- Frontend API client auto-generated from OpenAPI spec
```

---

#### `src-tauri/resources/claude-md/fastapi-boilerplate.md`

```markdown
# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from the FastAPI Boilerplate (benavlabs) on {{DATE}}.

## Architecture

- **Framework:** FastAPI with async SQLAlchemy 2.0
- **Validation:** Pydantic V2
- **Database:** PostgreSQL with Alembic migrations
- **Caching:** Redis
- **Background jobs:** ARQ (async Redis queue)
- **Package manager:** uv (fast Python package manager)
- **Containerization:** Docker Compose (optional)

## Project Structure

- `src/app/main.py` — Application entry point and lifespan
- `src/app/api/v1/` — API route handlers (versioned)
- `src/app/models/` — SQLAlchemy database models
- `src/app/schemas/` — Pydantic request/response schemas
- `src/app/crud.py` — Generic CRUD operations
- `src/app/core/` — Configuration, security, rate limiting
- `src/app/worker.py` — ARQ background worker
- `src/migrations/` — Alembic database migrations

## Commands

- `uv sync` — Install dependencies
- `uv run uvicorn src.app.main:app --reload` — Start dev server
- `cd src && uv run alembic revision --autogenerate` — Create migration
- `cd src && uv run alembic upgrade head` — Apply migrations
- `uv run pytest` — Run tests
- `docker compose up` — Start with Docker (includes PostgreSQL + Redis)

## Key Features

- Tier-based rate limiting (free/premium user tiers)
- JWT authentication with token blacklisting
- Background job queue with ARQ + Redis
- Superuser management via CLI
- API versioning (v1, v2, etc.)

## Conventions

- Models in `src/app/models/`, one file per entity
- Schemas in `src/app/schemas/`, matching model names
- Routes in `src/app/api/v1/`, one file per resource
- Use async/await throughout — no synchronous database calls
- Environment config via `.env` file (ENVIRONMENT=local|staging|production)
```

---

#### `src-tauri/resources/claude-md/astro-starter.md`

```markdown
# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded with Astro on {{DATE}}.

## Architecture

- **Framework:** Astro (static-first, island architecture)
- **Language:** TypeScript
- **Styling:** Tailwind CSS (if selected during setup)

## Project Structure

- `src/pages/` — File-based routing (`.astro` or `.md` files)
- `src/components/` — Reusable Astro/React/Vue/Svelte components
- `src/layouts/` — Page layout wrappers
- `src/content/` — Content collections (blog posts, docs)
- `src/styles/` — Global styles
- `public/` — Static assets (copied as-is to build output)
- `astro.config.mjs` — Astro configuration

## Commands

- `pnpm dev` — Start dev server
- `pnpm build` — Build for production (static output in `dist/`)
- `pnpm preview` — Preview production build
- `pnpm astro add <integration>` — Add an Astro integration (React, Tailwind, etc.)

## Conventions

- Pages are `.astro` files in `src/pages/` — each file becomes a route
- Use Astro components by default; React/Vue/Svelte for interactive islands only
- Content collections defined in `src/content/config.ts`
- Static assets in `public/`, referenced with absolute paths
- Minimize client-side JavaScript — Astro renders to static HTML by default
```

---

#### `src-tauri/resources/claude-md/expo-starter.md`

```markdown
# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded with Expo (React Native) on {{DATE}}.

## Architecture

- **Framework:** Expo with React Native
- **Language:** TypeScript
- **Routing:** Expo Router (file-based)

## Project Structure

- `app/` — Expo Router pages (file-based routing)
- `components/` — Reusable React Native components
- `constants/` — App constants (colors, config)
- `hooks/` — Custom React hooks
- `assets/` — Images, fonts, and other static assets

## Commands

- `npx expo start` — Start Expo dev server
- `npx expo start --ios` — Start on iOS simulator
- `npx expo start --android` — Start on Android emulator
- `npx expo start --web` — Start web version
- `npx expo install <package>` — Install Expo-compatible package
- `npx expo prebuild` — Generate native projects

## Conventions

- Screens/pages as files in `app/` directory (Expo Router)
- Use `expo install` instead of `npm install` for native packages (ensures compatibility)
- Styles: use React Native StyleSheet or NativeWind (Tailwind for RN)
- Test on both iOS and Android before committing
- No web-only CSS — all styling via React Native's style system
```

---

## 8. Template Icons

For the template picker cards, use Lucide icons as fallbacks and framework logos where possible:

| Template | Icon approach |
|----------|-------------|
| React + Vite | Lucide `Zap` icon (Vite-like) |
| React + shadcn | Lucide `Component` icon |
| Next.js | Lucide `Triangle` icon (Next.js-like) |
| Next.js SaaS | Lucide `CreditCard` icon |
| next-forge | Lucide `FolderTree` icon (monorepo) |
| FastAPI Official | Lucide `Server` icon |
| FastAPI Boilerplate | Lucide `Database` icon |
| Astro | Lucide `Rocket` icon |
| Expo | Lucide `Smartphone` icon |

Alternatively, store small SVG logos in `src/assets/template-icons/` for more recognizable branding. Framework logos (Next.js, Vite, Astro, Expo) are widely used in open-source contexts.

---

## 9. Registry Updates

### 9.1 Bundled Registry

The `templates.json` file ships with each app version. This ensures the app works offline and doesn't depend on a remote server.

### 9.2 Remote Refresh (Optional)

On app startup (once per day), attempt to fetch the latest registry from a GitHub raw URL:
```
https://raw.githubusercontent.com/<org>/templates/main/registry.json
```

If successful, cache locally and use instead of the bundled version. If fetch fails (offline, GitHub down), fall back to the bundled version silently.

This allows adding new templates or updating repo URLs without shipping a new app version.

### 9.3 Template Quality Maintenance

Every month, verify each template:
- Does the repo still exist?
- Has it been updated in the last 3 months?
- Does `git clone` + `install_command` still work?
- Are dependencies reasonably up to date?

Remove templates that become unmaintained. Add new high-quality templates as they emerge.

---

## 10. Implementation Phases

### Phase A: Core Scaffold Engine (Backend)

1. Create `src-tauri/src/commands/scaffold.rs` with `list_templates` and `scaffold_from_template` commands
2. Create `src-tauri/resources/templates.json` with the verified template list
3. Create all CLAUDE.md template files in `src-tauri/resources/claude-md/`
4. Register new commands in `lib.rs`
5. Test: scaffold a Next.js project end-to-end from the CLI

### Phase B: Template Picker UI (Frontend)

1. Add "Templates" tab to `ProjectPicker.tsx`
2. Create `TemplatePicker.tsx` with category filter and search
3. Create `TemplateCard.tsx` for the grid display
4. Create `TemplateDetail.tsx` for the expanded view
5. Create `ScaffoldProgress.tsx` for the step-by-step progress indicator
6. Wire up to Tauri invoke calls

### Phase C: CLI-Generated Templates

1. Add `scaffold_from_cli` command to handle Vite/Astro/Expo generators
2. Add the CLI-generated template entries to the registry
3. Handle interactive CLI prompts (pass flags to skip prompts where possible)

### Phase D: Polish

1. Add remote registry refresh on startup
2. Add error handling for all failure modes (network, git, install)
3. Add "View on GitHub" links in template detail view
4. Test all 9 templates end-to-end on a fresh macOS install

---

*End of specification. Place this file in the project's `_requirements/` directory alongside the other spec documents.*
