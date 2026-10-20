# Recipe Manager

A recipe manager for several competing restaurants that share one system.
Cooks search recipes by title, ingredient or tag, open them in a large-type
"cook mode" built for tablets (check off ingredients and steps, scale the
recipe ½×–4×, print it), and editors create, edit and delete them. Each
restaurant only ever sees its own recipes: another restaurant's recipe
returns 404. Simultaneous edits are caught with a version check (409), and
deletes can be undone. The backend is FastAPI with SQLAlchemy on SQLite
(Postgres by config). The frontend is React with TypeScript. Both run with
one `docker compose up`.

- Design and trade-offs: [docs/DESIGN.md](docs/DESIGN.md)
- AI prompts used: [docs/PROMPTS.md](docs/PROMPTS.md)

![Cook mode](docs/screenshots/cook-mode.png)

## Prerequisites

| To… | You need | Versions used to build and test this |
|---|---|---|
| Run the app (recommended path) | Docker with Compose v2 | Docker 29.7.2, Compose 5.4.0 |
| Run backend tests or the API without Docker | Python 3.12+ | Python 3.12.12 |
| Run frontend tests or the dev server without Docker | Node.js 20+ with npm | Node 20 (`node:20-alpine` image) |
| Run the browser smoke test | Docker only (uses the Playwright image) | `mcr.microsoft.com/playwright/python:v1.48.0-jammy` |

Ports **8080** (app) and **8000** (API) must be free. Older Docker, Python or
Node versions weren't tested.

Pinned library versions are in `backend/requirements*.txt` and
`frontend/package.json`. The main ones: FastAPI 0.148, SQLAlchemy 2.1,
Pydantic 2.14, React 18.3, react-router 6.26, Vite 5.4, TypeScript 5.6,
Vitest 2.1.

## Run

```bash
git clone https://github.com/jontromanab/recipe-manager.git
cd recipe-manager
docker compose up --build
```

| URL | What |
|---|---|
| http://localhost:8080 | The app |
| http://localhost:8000/docs | API docs (Swagger UI) |
| http://localhost:8000/api/health | Health check |

The first start seeds two restaurants with 4 recipes each. Data is kept in
the `recipe-data` Docker volume across restarts. To stop and wipe it:

```bash
docker compose down -v
```

### Seeded users and stub tokens

Sign-in is stubbed. In the app, switch users with the picker in the top
right. For the API, send `Authorization: Bearer <token>`.

| Token | User | Restaurant (`org_id`) | Role | Can |
|---|---|---|---|---|
| `bistro-editor` | Ana (chef) | Bistro Verde (`bistro`) | editor | read, create, edit, delete, restore |
| `bistro-viewer` | Ben (line cook) | Bistro Verde (`bistro`) | viewer | read only |
| `harbor-editor` | Chloe (chef) | Harbor Grill (`harbor`) | editor | read, create, edit, delete, restore |
| `harbor-viewer` | Dev (line cook) | Harbor Grill (`harbor`) | viewer | read only |

Both restaurants have a recipe called "House Vinaigrette", which makes it
easy to see that each one only gets its own.

### Try the API

```bash
curl -H "Authorization: Bearer bistro-viewer" "localhost:8000/api/recipes?q=rosemary"
curl -H "Authorization: Bearer bistro-viewer" "localhost:8000/api/recipes/2?scale=0.5"
curl -i -H "Authorization: Bearer harbor-viewer" localhost:8000/api/recipes/1    # 404: Bistro's recipe
curl -i -X DELETE -H "Authorization: Bearer bistro-viewer" localhost:8000/api/recipes/1   # 403: viewer
```

### Run without Docker

```bash
# Terminal 1: API on http://localhost:8000
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn --factory app.main:create_app --reload

# Terminal 2: frontend on http://localhost:5173 (proxies /api to :8000)
cd frontend
npm ci
npm run dev
```

Configuration (environment variables, read by `backend/app/config.py`):

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/recipes.db` | Postgres: `postgresql+psycopg://user:pass@host:5432/db` (driver already installed) |
| `SEED_ON_STARTUP` | `true` | Seeds only restaurants that have no recipes yet |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list. Only needed if the frontend calls the API from another origin. |

## Test

```bash
# Backend: 103 tests (API, repository, schemas, scaling)
cd backend && .venv/bin/pytest -q

# Same suite against Postgres (any empty database)
TEST_DATABASE_URL=postgresql+psycopg://postgres:pw@localhost:5432/recipes .venv/bin/pytest -q

# Frontend: 36 tests (formatting, form errors, React Testing Library components) + typecheck
cd frontend && npm test && npm run build
```

Without local Python or Node, run the same tests in containers:

```bash
docker compose run --rm api pytest -q
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/frontend":/app -w /app node:20-alpine sh -c "npm ci && npm test"
```

**Browser smoke test** (needs the stack running). It drives the real UI in
headless Chromium and writes screenshots to `docs/screenshots/`:

```bash
docker run --rm --network host -v "$PWD/e2e":/work -v "$PWD/docs/screenshots":/out -w /work \
  mcr.microsoft.com/playwright/python:v1.48.0-jammy \
  sh -c "pip install -q playwright==1.48.0 && python smoke_test.py"
```

It creates and deletes one recipe and edits another (then restores its
title), so run it against demo data.

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
- backend tests on SQLite
- backend tests on Postgres 16
- frontend tests, typecheck and build
- a clean `docker compose up` that checks health, seed data, the
  cross-restaurant 404 and that the frontend is served

## Screenshots

Taken by the browser smoke test against the running app.

| Recipe list (search, tags) | Cook mode (scaled ×2, steps checked off) |
|---|---|
| ![Recipe list](docs/screenshots/list.png) | ![Cook mode](docs/screenshots/cook-mode.png) |

| Inline validation errors | Edit conflict (409) |
|---|---|
| ![Validation errors](docs/screenshots/validation.png) | ![Edit conflict](docs/screenshots/conflict.png) |

| Delete confirmation | Print layout |
|---|---|
| ![Delete confirmation](docs/screenshots/delete-confirm.png) | ![Print layout](docs/screenshots/print.png) |

| Phone, dark mode |
|---|
| ![Phone, dark mode](docs/screenshots/phone-dark.png) |

## Project layout

```
backend/app/
  main.py            app factory; /health and /me
  config.py          settings from environment
  db.py              engine and session
  models.py          recipes table
  schemas.py         request/response models and validation
  auth.py            stub tokens → user (org, role)
  repository.py      org-scoped data access: search, versions, soft delete
  scaling.py         yield scaling (pure functions)
  errors.py          error types and the JSON error shape
  routers/recipes.py recipe endpoints
  seed.py            demo data for two restaurants
backend/tests/       pytest suites
frontend/src/
  api.ts             typed API client
  auth.tsx           stub "sign in as" picker
  lib/               formatting and form-error helpers (+ tests)
  pages/             RecipeList, RecipeView (cook mode), RecipeEdit (+ tests)
e2e/smoke_test.py    Playwright browser smoke test
docs/                DESIGN.md, PROMPTS.md, screenshots/
.github/workflows/   CI
```
