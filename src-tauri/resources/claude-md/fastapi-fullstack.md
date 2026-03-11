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
