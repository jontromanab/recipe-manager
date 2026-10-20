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

## 4. Checking the backend against a stricter brief

> Implement the backend per the approved plan: models, repository layer with
> tenant scoping, auth stub, endpoints, validation, seed data. Write pytest
> tests alongside, including a tenant isolation suite, viewer-cannot-edit,
> 409 on stale version, soft delete/restore, scaling edge cases (0, negative,
> huge factor), and search with empty/special-character queries. Run the
> tests and fix failures before stopping.

Claude mapped each item to existing tests and found one gap; I asked it to
add a test for whitespace-only search.

## 5. Frontend

> Implement the frontend: recipe list with search, cook-mode recipe view
> (large type, high contrast, tap to check off steps, scale buttons, print
> stylesheet), create/edit form with validation errors shown inline, delete
> with confirmation. Add one or two component tests. Keep it simple and
> readable.

Claude listed what was already built and what was missing. I chose: add a
delete confirmation, a print stylesheet, inline field errors, tap-to-check
steps, and component tests with React Testing Library.

## 6. Reviewer pass and CI

> Act as a reviewer who just cloned this repo. Verify docker compose up works
> from a clean state, seed data loads, and all tests pass. Fix anything that
> breaks. Add a GitHub Actions workflow that runs backend and frontend tests.
> Make sure .gitignore excludes local DB files, env files, node_modules and
> caches.

Claude cloned the repo fresh from GitHub, built it with no cache, and ran
every test suite. Nothing broke. It then added the CI workflow, including a
clean `docker compose up` check, and tightened `.gitignore`.

## How the work was checked

- Claude wrote tests alongside the code: 100 backend tests (pytest) and 36
  frontend tests (vitest and React Testing Library).
- It ran the full stack with `docker compose` and called the API with
  `curl`: seed data, cross-org 404, scaling, viewer 403, data kept across a
  restart.
- It drove the UI in headless Chromium (`e2e/smoke_test.py`) and looked at
  the screenshots. That found two UI issues, both fixed: a repeated yield
  label ("20 portion · 20 portions") and the save-conflict banner being off
  screen. Later, a component test caught ingredient names being read aloud
  as "1 ½ cuponion" (missing space), and the print screenshot showed
  checkmarks printing instead of step numbers.
