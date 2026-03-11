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
