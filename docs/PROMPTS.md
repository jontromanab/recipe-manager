# AI prompts used

I used Claude Code (Claude Opus) as a pair programmer. These are the main
prompts, lightly trimmed. I reviewed the design, pushed back where needed,
and checked tests and behavior myself.

## 1. Planning

> Read the assignment. This is a take-home for a recipe management system with
> a hard time box of about 4 hours, so favor a clean, well-tested skeleton over
> feature breadth.
>
> Propose a plan before writing code. My intended design:
> - Backend: Python, FastAPI, SQLAlchemy, SQLite (swappable to Postgres via config), pytest
> - Frontend: React + Vite + TypeScript, tablet-friendly "cook mode" view
> - Multi-tenancy: every recipe belongs to an org; tenant scoping enforced in a
>   repository layer; cross-org access returns 404, not 403
> - Auth: stubbed bearer tokens mapped to seeded users with org and role (viewer/editor)
> - Recipe model: title, tags, structured yield (quantity, unit, optional portions),
>   ordered ingredient lines (quantity, unit, name, prep note), ordered steps
> - Search over title, ingredients and tags; pagination
> - Optimistic concurrency via a version field (409 on stale update); soft delete with restore
> - Server-side yield scaling
> - `docker compose up` as the main run path, plus seed data with two orgs
>
> Push back if anything here is over-engineered for the stated scale. Give me the
> directory layout, API endpoints, and test plan.

What came back and what I accepted: store ingredients/steps/tags as JSON
columns instead of child tables, use a denormalized `search_text` column with
`LIKE` instead of full-text search, skip Alembic, keep the repository thin, and
make restore API-only.

## 2. Repo setup

> We have to upload this to GitHub. Make sure not to include the assignment file.

> Call it recipe-manager, and the GitHub repo too. It should be private.
> The plan is OK, go ahead.

## 3. Deliverables

> They have asked "When using AI, please send over some of the prompts that
> you used", so let's keep aside some prompts (simple ones).

## How the work was checked

- Claude wrote tests alongside the code: 97 backend tests (pytest) and 21
  frontend tests (vitest).
- It ran the full stack with `docker compose` and called the API with
  `curl`: seed data, cross-org 404, scaling, viewer 403, data kept across a
  restart.
- It drove the UI in headless Chromium (`e2e/smoke_test.py`) and looked at
  the screenshots. That found two UI issues, both fixed: a repeated yield
  label ("20 portion · 20 portions") and the save-conflict banner being off
  screen.
