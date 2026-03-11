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
