# {{PROJECT_NAME}}

## Stack
Next.js, TypeScript, Nextra, MDX

## Structure
- `pages/` — MDX content files (file = page, folder = section)
- `pages/_meta.json` — Navigation order and page titles for each folder
- `theme.config.tsx` — Nextra theme configuration (logo, links, footer, search)
- `next.config.mjs` — Next.js config wrapped with withNextra()

## Commands
- `pnpm dev` — Start dev server (http://localhost:3000)
- `pnpm build` — Production build

## Conventions
- Every folder needs a `_meta.json` to define page order and display names
- MDX files in `pages/` map directly to URL routes
- Nextra auto-generates sidebar from folder structure + _meta.json
- Code blocks get syntax highlighting automatically (Shiki-based)
- Search is built-in (flexsearch), no extra config needed
