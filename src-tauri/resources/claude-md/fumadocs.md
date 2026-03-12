# {{PROJECT_NAME}}

## Stack
Next.js (App Router), TypeScript, Tailwind CSS, Fumadocs (MDX + Core + UI)

## Structure
- `content/docs/` — Documentation pages as .mdx files (folder = sidebar group)
- `app/(home)/` — Landing page and non-docs routes
- `app/docs/` — Documentation layout and page rendering
- `app/api/search/` — Search API route handler
- `lib/source.ts` — Content source adapter (loader() provides typed content access)
- `source.config.ts` — Content collections schema and frontmatter config

## Commands
- `pnpm dev` — Start dev server (http://localhost:3000)
- `pnpm build` — Production build

## Conventions
- Docs go in `content/docs/` as .mdx files; folder structure = sidebar navigation
- Frontmatter: title, description, icon (optional) — validated by source.config.ts
- Use `meta.json` in folders to control sidebar order and labels
- Search is built-in via the API route in `app/api/search/`
- Use Fumadocs UI components: Callout, Card, Tab, Steps, TypeTable
