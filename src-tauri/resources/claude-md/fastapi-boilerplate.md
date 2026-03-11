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
