# CLAUDE.md — {{PROJECT_NAME}}

Scaffolded from Nextplate (zeon-studio/nextplate) on {{DATE}}.

## Architecture

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 4 with PostCSS, @tailwindcss/forms, @tailwindcss/typography
- **Content:** MDX via next-mdx-remote, frontmatter via gray-matter
- **Dark mode:** next-themes
- **SEO:** next-sitemap (auto-generated after build)
- **Comments:** Disqus (disqus-react)
- **Analytics:** Google Tag Manager (react-gtm-module)
- **Images:** sharp for optimization

## Project Structure

- `src/app/` — Next.js App Router pages and layouts
- `src/content/` — Markdown/MDX content files (blog posts, authors, pages)
- `src/layouts/` — Page layout components (Base, Posts, About, etc.)
- `src/layouts/components/` — Shared layout parts (header, footer, sidebar, pagination)
- `src/layouts/shortcodes/` — MDX shortcode components (Accordion, Tabs, Notice, YouTube, etc.)
- `src/lib/` — Utility functions (content parsing, taxonomy helpers, text utils)
- `src/config/` — Site configuration (menu, social links, theme settings)
- `src/hooks/` — Custom React hooks
- `src/types/` — TypeScript type definitions
- `scripts/` — Build-time scripts (JSON generator, theme generator)
- `public/images/` — Static images

## Commands

- `npm run dev` — Start development server (http://localhost:3000)
- `npm run build` — Production build (generates theme + JSON data, then next build + sitemap)
- `npm run preview` — Start production server (next start)
- `npm run lint` — Run ESLint
- `npm run format` — Run Prettier

## Content

- Blog posts live in `src/content/` as Markdown/MDX files with YAML frontmatter
- Frontmatter fields: title, description, date, image, authors, categories, tags, draft
- MDX shortcodes available: Accordion, Tabs, Notice, YouTube, Button, Video, Badge
- Multi-author support: author profiles in `src/content/authors/`
- Taxonomy pages auto-generated for categories and tags

## Conventions

- Use App Router conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`
- Content goes in `src/content/` as `.md` or `.mdx` files, not in the database
- Site-wide config (menus, social links, site metadata) in `src/config/`
- All styling via Tailwind utility classes; theme variables defined in CSS
- No `any` types. Strict TypeScript throughout.
- Images go in `public/images/`; reference via `/images/` paths in content
