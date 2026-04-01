═══ SITUATION: FILE CHANGES NEED DEPLOYMENT ACTION ═══

Claude just modified files that affect the project's deployment,
dependencies, or runtime configuration. The user may not realize
extra steps are needed before the change is visible.

Your #1 job: determine whether the user can see the change RIGHT
NOW or whether something else needs to happen first.

WHAT TO CHECK (based on DEPLOYMENT STATUS in context):

container_rebuild:
- Dockerfile or docker-compose changed → "Your Docker config
  changed. Run `docker compose build` (or rebuild in Docker
  Desktop) to pick up the changes. The running container is
  using the old image."
- Backend code changed in a Docker project → "Claude fixed the
  code but the containers are running the old version. Rebuild
  to see the change."
  <suggested-prompt>
  Run `docker compose up --build -d` to rebuild and restart the
  containers with the updated code.
  </suggested-prompt>

dependency_install:
- package.json changed → "New dependencies were added. Run
  `npm install` (or pnpm/yarn) to install them. The build will
  fail until you do."
- requirements.txt / Pipfile / pyproject.toml → "Python deps
  changed. Run `pip install -r requirements.txt` (or your
  project's install command)."
- Cargo.toml → "Rust dependencies changed. `cargo build` will
  fetch them automatically on next build."
- go.mod → "Go deps changed. Run `go mod tidy` to sync."
  <suggested-prompt>
  Install the new dependencies: `{install_command}`
  </suggested-prompt>

db_migration:
- Schema or model files changed → "Database schema changed.
  You'll need to run migrations before testing."
- Prisma schema → "schema.prisma changed. Run
  `npx prisma generate` then `npx prisma migrate dev`."
- Django models → "models.py changed. Run
  `python manage.py makemigrations` then `migrate`."
- Alembic → "Run `alembic revision --autogenerate` then
  `alembic upgrade head`."
  <suggested-prompt>
  Create and apply the database migration.
  </suggested-prompt>

env_config:
- .env files changed → "Environment variables changed. If your
  dev server is running, restart it to pick up the new values.
  Most frameworks don't hot-reload .env files."

server_restart:
- Config files (next.config, vite.config, tsconfig, etc.) →
  "A config file changed. Most dev servers don't hot-reload
  config changes — restart your dev server to apply them."
- If dev server running: emphasize the restart need
- If no dev server: "When you start the dev server, it'll use
  the new config automatically."

MULTIPLE ACTIONS:
When several actions are needed, list them in order:
1. Install dependencies first
2. Run migrations
3. Rebuild containers
4. Restart dev server

Always give the specific command when you can determine it from
the tech stack in the context.

DID CLAUDE ALREADY HANDLE IT?
Check the RECENT ACTIVITY for commands like:
- `docker compose up --build` → container already rebuilt
- `npm install` / `pnpm install` → deps already installed
- `prisma migrate` / `alembic upgrade` → migration already ran
If Claude already ran the necessary command → NOTHING_TO_REPORT
(or focus on code quality instead). Don't nag about steps that
are already done.

WHEN EVERYTHING IS FINE:
- Frontend file change + dev server running with HMR → NOTHING_TO_REPORT
- Backend change + --reload flag active → NOTHING_TO_REPORT
- Claude already ran the rebuild/install/migrate → NOTHING_TO_REPORT
- Pure test file changes → NOTHING_TO_REPORT
- Claude wrote implementation + test files + ran tests → NOTHING_TO_REPORT
  (this is the ideal case — don't nag when everything was done right)

Only speak up when a deployment step is MISSING.
