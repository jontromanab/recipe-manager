# Design

This document describes the system as it exists in this repository. Numbers
marked *measured* come from the benchmark described in
[Verification notes](#verification-notes). Anything that's an estimate or a
projection is labeled that way.

## Contents

1. [Requirements](#requirements)
2. [Architecture overview](#architecture-overview)
3. [Data model](#data-model)
4. [API](#api)
5. [Decisions](#decisions)
6. [Testing strategy](#testing-strategy)
7. [Deliberately not built / next steps](#deliberately-not-built--next-steps)
8. [What would change at 100x](#what-would-change-at-100x)
9. [Verification notes](#verification-notes)

## Requirements

| From the brief | What it means here |
|---|---|
| ≤ 10,000 requests/day | About 0.12 req/s on average. Even if most traffic lands in a few service hours, the peak is in the low tens of req/s (*estimate*). |
| ≤ 1,000 recipes | The whole dataset is about 2 MB in SQLite (*measured*). |
| Several dozen users across competing restaurants | Isolation between restaurants is the main correctness requirement. |
| Easy to read in a kitchen | Large type, big tap targets, scaling, check-off, printable. |
| Edit and remove | Concurrent edits must not silently overwrite each other, and deletes should be recoverable. |

## Architecture overview

```
 Browser (tablet / phone / desktop)
        │
        ▼  :8080
 ┌────────────────────┐  /api/*   ┌──────────────────────────────────────────┐
 │ web: nginx         │ ────────► │ api: FastAPI + uvicorn (1 process)       │
 │ built React app    │           │                                          │
 │ SPA fallback       │           │ routers/recipes.py   HTTP, query params  │
 └────────────────────┘           │ auth.py              token → User        │
                                  │ repository.py        org-scoped queries  │
                                  │ scaling.py           pure functions      │
                                  │ schemas.py           validation          │
                                  │ errors.py            one JSON error shape│
                                  └───────────────────┬──────────────────────┘
                                                      ▼
                                   SQLite file on the recipe-data volume
                                   (or Postgres via DATABASE_URL)
```

- **Two containers** (`docker-compose.yml`). `web` is a multi-stage build:
  Node 20 runs `npm test` and `npm run build`, then nginx 1.27 serves the
  static files and proxies `/api/` to `api:8000`. The browser only talks to
  one origin, so CORS isn't needed. In local dev the Vite server proxies
  `/api` the same way. The API's CORS setting (`CORS_ORIGINS`, default
  `http://localhost:5173`) only matters if the frontend calls the API
  directly.
- **The API is stateless.** All state is in the database. The stub users are
  constants in `auth.py`.
- **Startup** (`main.py` lifespan) creates tables if missing, then seeds each
  restaurant that has no recipes yet (`seed.py`; can be disabled with
  `SEED_ON_STARTUP=false`).
- `create_app(settings)` is a factory. Tests build an app per test with its
  own database, and uvicorn runs it with `--factory`.

**Frontend** (`frontend/src`): React 18 with react-router 6, no state
library. `api.ts` is a typed `fetch` wrapper that turns error responses into
an `ApiError`. Pages:

| Page | What it does |
|---|---|
| `RecipeList` | Search as you type (250 ms debounce), tag chips, 12 per page. Query, tag and page live in the URL. Undo banner after a delete. |
| `RecipeView` (cook mode) | Large type, two columns at ≥ 820 px. Tap to check off ingredients and steps; first unchecked step highlighted; ½×–4× scale buttons (scaling done by the API); inline delete confirmation; screen kept awake via the Wake Lock API where available; print stylesheet. |
| `RecipeEdit` | Create and edit. Ingredient and step rows with reorder and remove; API validation errors shown under the matching field; 409 conflict banner with "load their version". |

Switching the stub user remounts every page (`<Routes key={token}>`), so
nothing from the previous restaurant stays on screen.

## Data model

One table, `recipes` (`backend/app/models.py`). Users and restaurants aren't
stored in the database yet; they're constants in `auth.py` (see
[next steps](#deliberately-not-built--next-steps)).

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `org_id` | string(64), indexed | Owning restaurant. Set from the authenticated user, never from the request body. |
| `title` | string(200) | |
| `tags` | JSON list of strings | Trimmed, lowercased, de-duplicated; ≤ 20 tags, each ≤ 40 chars |
| `yield_quantity` | float | > 0 |
| `yield_unit` | string(32) | Free text, e.g. "quart", "hotel pan" |
| `yield_portions` | float, nullable | Optional portion count |
| `ingredients` | JSON list | Ordered `{quantity, unit, name, note}`. 1–200 lines; `quantity` > 0 or null for "to taste"; name ≤ 120, unit ≤ 32, note ≤ 200 |
| `steps` | JSON list of strings | Ordered; 1–100 steps, each non-blank and ≤ 2,000 chars |
| `search_text` | text | Derived on write: lowercased title, tags and ingredient names |
| `tags_index` | text | Derived on write: `\|tag1\|tag2\|` for whole-tag matching |
| `version` | integer | Starts at 1, +1 on every write. SQLAlchemy `version_id_col`. |
| `created_at`, `updated_at` | timestamp with time zone | |
| `deleted_at` | timestamp, nullable | Set when soft-deleted |

The API exposes yield as one object: `"yield": {"quantity", "unit", "portions"}`.

## API

Everything is under `/api`. All routes except `/health` need
`Authorization: Bearer <token>`. Interactive docs are at
`http://localhost:8000/docs`.

| Method | Path | Role | Success | Notes |
|---|---|---|---|---|
| GET | `/health` | none | 200 | `{"status": "ok"}` |
| GET | `/me` | any | 200 | user id, name, org, role |
| GET | `/recipes` | any | 200 | `q` (≤ 100 chars), `tag` (≤ 40), `limit` 1–100 (default 20), `offset` ≥ 0. Returns `{items, total, limit, offset}`; items are summaries (no ingredients/steps), sorted by title (case-insensitive), then id. |
| POST | `/recipes` | editor | 201 | Returns the full recipe, `version: 1` |
| GET | `/recipes/{id}` | any | 200 | Optional `scale` **or** `target_yield` (not both). Response includes `scale_factor`. |
| PUT | `/recipes/{id}` | editor | 200 | Full replace. Body must include the `version` the client loaded. |
| DELETE | `/recipes/{id}` | editor | 204 | Soft delete |
| POST | `/recipes/{id}/restore` | editor | 200 | Undo a soft delete |

**Errors.** Every error, including validation errors, unknown routes and
unexpected exceptions, is returned as
`{"error": {"code": "...", "message": "...", ...extra}}`:

| Status | `code` | When |
|---|---|---|
| 401 | `unauthorized` | Missing or unknown token (also sends `WWW-Authenticate: Bearer`) |
| 403 | `forbidden` | A viewer tries to write |
| 404 | `not_found` | Recipe doesn't exist, belongs to another restaurant, or is deleted; restore of a recipe that isn't deleted |
| 404 | `http_error` | Unknown route |
| 409 | `version_conflict` | Stale `version` on PUT; includes `current_version` |
| 422 | `invalid_input` | Body or query validation failed; `details: [{loc, msg}]`. Also bad scale factor. |
| 500 | `internal_error` | Unexpected exception. Generic message only; details are logged server-side. |

## Decisions

### Tenant isolation: enforced in the repository, 404 rather than 403

Every recipe has an `org_id`. Routes never query the database directly. They
build `RecipeRepository(session, user.org_id)`, and every query goes through
`_scoped()`, which always adds `WHERE org_id = :org AND deleted_at IS NULL`.
The constructor refuses an empty `org_id`, and the org always comes from the
authenticated user.

Another restaurant's recipe returns **404, not 403**. A 403 would confirm
that recipe ID 17 exists and belongs to someone else, which tells a
competitor something. With 404, "not yours" and "doesn't exist" look the
same. Viewers trying to write *in their own restaurant* do get 403, because
that reveals nothing.

*Trade-off:* isolation depends on every query going through the repository.
Tests check every method across orgs. A database-level backstop (Postgres
row-level security) is listed under next steps.

### Right-sizing for 10k requests/day and 1,000 recipes

At this size the risks are correctness problems (data leaking between
restaurants, lost edits, unreadable recipes), not throughput. So the design
leaves out caches, queues, search engines and multiple services. With 1,000
recipes loaded (500 per restaurant), the API answers list, search and get
requests in 2–8 ms at the median on both SQLite and Postgres (*measured*,
see [Verification notes](#verification-notes)). That's far below anything a
user would notice, so no optimization work was done.

### SQLite by default, Postgres by configuration

SQLite on a Docker volume needs nothing extra to run or back up (one ~2 MB
file). `DATABASE_URL` switches to Postgres. The Postgres driver (`psycopg`)
is already in `requirements.txt`, and the code doesn't use any
database-specific features: JSON columns, `LIKE … ESCAPE`, `lower()`.
**Verified:** the full backend test suite passes on Postgres 16, and CI runs
it there on every push.

Tables are created at startup with `create_all` instead of migrations.
Alembic should be added before the first schema change on a deployed
database.

*Trade-off:* SQLite serializes writes, and each commit waits on the disk,
so an update takes about 34 ms versus about 11 ms on Postgres (*measured*).
At this write volume (a few dozen editors) that's fine.

### Optimistic concurrency with a version number

Two cooks can open the same recipe. Each `PUT` must include the `version` it
loaded. If the stored version is different, the API returns **409** with
`current_version`, and the UI offers to load the other cook's version
instead of silently overwriting it. The repository checks the version
explicitly, and `version` is also SQLAlchemy's `version_id_col`, so the
UPDATE itself runs with `WHERE version = :old`. That catches a second writer
who commits between the check and the commit (there's a test for this race).

Locking was rejected: someone who opens the edit screen and walks away would
block everyone else.

### Soft delete with restore

`DELETE` sets `deleted_at`, and `POST /restore` clears it. Deleted recipes
behave as missing (404) on every other endpoint, including a second DELETE.
In the UI, Delete first asks "Delete this recipe?" inline, and afterwards an
Undo banner calls restore.

*Not built:* a trash view, purging old deleted rows, and restoring after a
navigation away from the list (the Undo banner is the only UI path).

### Search

On every write the repository stores `search_text` (lowercased title, tags
and ingredient names) and `tags_index` (`|sauce|cold station|`).

- `q` is split on whitespace, and **every** word must appear somewhere
  (`LIKE '%word%'`). Whitespace-only `q` means no filter.
- `%`, `_` and `\` in user input are escaped, so `100%` matches literally.
- `tag` matches a whole tag only (`sou` doesn't match `soup`),
  case-insensitively.
- Results are always restricted to the user's restaurant.

This is a table scan. It's portable across SQLite and Postgres, and fast at
this size (*measured*: 3.5 ms median for a two-word search over 500
recipes). There's no ranking, stemming or typo tolerance.

### Scaling

`GET /recipes/{id}?scale=2` or `?target_yield=24` returns the recipe with
yield, portions and every ingredient quantity multiplied
(`backend/app/scaling.py`, pure functions with no I/O). Scaled results are
never saved.

- Factor must be between 0.01 and 100. `scale` and `target_yield` together
  return 422. `target_yield` is in the recipe's own yield unit.
- Quantities are rounded to 3 decimal places to remove float noise.
  "To taste" lines (no quantity) stay empty.
- **Units are never converted.** 8 cups stays 8 cups, not 2 quarts. Unit
  conversion needs ingredient densities and kitchen conventions to be
  correct, so it's left out.
- The frontend shows kitchen fractions for US units (`1 ½ cup`, `⅓ tsp`) and
  plain decimals for metric units (`7.5 g`); see `lib/format.ts`.

The UI currently offers fixed factors only (½× to 4×). `target_yield` exists
in the API but has no UI control yet.

### Authentication (stub)

`auth.py` maps four fixed bearer tokens to users, each with an org and a role
(`viewer` or `editor`). Routes depend only on `CurrentUser` or `EditorUser`,
so swapping in real token validation (OIDC/JWT) is contained to that file.
The frontend's "sign in as" picker lists the same four tokens.

### Cost and deployment

The repository ships **only** a Docker Compose setup: `docker compose up`
runs both containers, with data on a named volume. No cloud deployment,
TLS, domain or backup configuration is included.

*Estimate, not priced:* at the measured latencies, one small VM or container
host running this Compose file is enough for the stated load, and there's
no managed database to pay for. Backups would be a scheduled copy of the
SQLite file (e.g. `sqlite3 .backup`) to object storage. None of that is
automated in this repo.

## Testing strategy

| Layer | Files | Covers |
|---|---|---|
| Pure logic (backend) | `test_scaling.py`, `test_schemas.py` | Factor limits (0, negative, 0.001, 101, 1000), `scale` and `target_yield` together, rounding, "to taste" lines, no mutation of input; every validation rule including step length and tag normalization |
| Repository | `test_repository.py` | Tenant isolation for get/list/update/delete/restore; soft delete and restore; version bump, stale version, and the commit race; search by title, ingredient and tag, case, multi-word, empty and whitespace-only, `%`/`_` escaping; whole-tag filter; pagination edges |
| HTTP API | `test_api_recipes.py` | 401/403; full create → get → update → delete → restore round trip; cross-org 404 on all four methods with no side effects; 409 body; 422 details; query-param bounds; scaling endpoint; error shape for unknown routes and unexpected exceptions; seed idempotence |
| Pure logic (frontend) | `format.test.ts`, `formErrors.test.ts` | Fractions and decimals, yield wording, tag parsing; mapping API errors to form fields, including rows dropped as blank |
| Components | `RecipeView.test.tsx`, `RecipeEdit.test.tsx` (React Testing Library) | Step check-off in any order, scale request, delete confirmation, viewers see no edit/delete; inline errors on the right field and row; data sent on save |
| End to end | `e2e/smoke_test.py` (Playwright, headless Chromium) | Against the running Compose stack: search, tag filter, scaling, step check-off, print layout, edit conflict, inline validation, delete confirm and undo, switching restaurants, 390 px width with no horizontal scroll, no console errors |

Each backend test gets a fresh database: in-memory SQLite by default, or the
database in `TEST_DATABASE_URL` (tables dropped after each test).

**CI** (`.github/workflows/ci.yml`, runs on every push and PR):
1. Backend tests on SQLite.
2. Backend tests on Postgres 16.
3. Frontend tests, typecheck and build.
4. A clean `docker compose up --wait` that checks health, seed counts, the
   cross-restaurant 404, and that the frontend is served.

The Playwright smoke test is **not** in CI. It's run by hand (command in the
README).

## Deliberately not built / next steps

Not built, roughly in the order I'd add them:

1. **Real authentication.** OIDC login, and users, restaurants and
   memberships stored in the database, with an admin role. Today they're
   constants.
2. **Database-level isolation backstop.** Postgres row-level security keyed
   on the org, so a missed filter in code still can't leak data.
3. **Migrations** (Alembic) before the first deployed schema change.
4. **Change history.** Keep each version (who changed what, when) and allow
   rollback. The `version` column is the starting point.
5. **Ingredient catalog and unit conversion.** That would enable costing,
   allergen flags and "make 3 quarts" across units.
6. **Trash view and purge** for soft-deleted recipes.
7. **A `target_yield` input in the UI** (the API already supports it).
8. **Deployment:** TLS, backups, a non-root container user, structured logs,
   metrics, error tracking, rate limiting.
9. **Offline support** for kitchens with bad Wi-Fi (cache the recipes
   currently in use).

Also out of scope on purpose: internationalization (per the brief), images,
and the Playwright test in CI.

## What would change at 100x

*Projections, not measured.* 100x means about 1M requests/day (peaks of a
few hundred req/s), about 100,000 recipes, and thousands of users across
hundreds of restaurants.

| Area | Today | At 100x |
|---|---|---|
| Database | SQLite file | Managed Postgres with point-in-time recovery; row-level security on; connection pooling (PgBouncer) |
| Search | `LIKE` scan over `search_text` | `pg_trgm` GIN index (substring and typo tolerance) or `tsvector` full-text with ranking. Still in Postgres; a separate search engine only if ranking needs grow. |
| List pagination | `OFFSET` plus `COUNT(*)` | Keyset (cursor) pagination; the count is approximate or computed only on the first page |
| API | 1 uvicorn process | Several stateless replicas behind a load balancer, autoscaled (the app keeps no in-process state, so this needs no code change) |
| Data model | Ingredients as JSON | Ingredient table linked to a catalog, once reporting (cost, allergens, inventory) needs SQL access to lines |
| Auth and tenancy | Stub tokens, org on the recipe | OIDC, org membership table, per-org roles, audit log |
| Frontend | Served by nginx in the same Compose stack | Static hosting on a CDN; recipe responses cacheable with ETag based on `version` |
| Operations | `docker compose` | Container platform, migrations in the deploy pipeline, tracing, SLOs, per-org rate limits |

What stays the same: the repository-level scoping, the 404 policy, version
conflicts, soft delete, and the pure scaling module.

## Verification notes

**Verified in this repo:**

| Claim | How |
|---|---|
| All tests pass | 103 backend tests (SQLite and Postgres 16), 36 frontend tests, typecheck and build. All run in CI. |
| Postgres works with no code change | Full backend suite with `TEST_DATABASE_URL` set to Postgres 16 (locally and in CI). The API Docker image was also started against Postgres; it seeded the data and served search. |
| Fresh clone works | At commit `0457d90`: cloned from GitHub into an empty directory, `docker compose build --no-cache` and `up`, checked health, seed data (4 + 4 recipes), frontend and Swagger, then ran every test suite. CI repeats the Compose check on each push. |
| UI behavior | Playwright smoke test against the running stack (manual run). Screenshots in `docs/screenshots/` come from it. |
| Latency and size at 1,000 recipes | `GET` requests through FastAPI's in-process test client, 200 samples each. 500 recipes per restaurant with 15 ingredients and 8 steps each. One client, on a 13th-gen Intel i9 laptop. |

Measured results (median / 95th percentile, ms):

| Request | SQLite | Postgres 16 |
|---|---|---|
| List, first page | 3.6 / 7.3 | 8.1 / 11.9 |
| Search, two words | 3.5 / 6.2 | 8.1 / 11.6 |
| Search, no match | 2.8 / 4.9 | 5.6 / 8.6 |
| Tag filter | 3.4 / 6.1 | 5.2 / 10.1 |
| Get, scaled ×2 | 2.1 / 3.5 | 3.8 / 6.2 |
| Get + update | 33.7 / 37.9 | 11.4 / 18.4 |

SQLite file size with 1,000 recipes: about 2 MB.

**Not verified:**

- **Minimum versions.** Only the versions listed in the README were
  actually used (Docker 29.7, Compose 5.4, Python 3.12, Node 20). Older
  versions may work but weren't tried.
- **Performance over a real network, under concurrent load, or on small
  hardware.** The numbers above are single-client and in-process on a fast
  laptop. No load test was run.
- **Postgres versions other than 16.**
- **Browsers other than Chromium,** and real touch devices. Tablet and phone
  layouts were checked with viewport emulation only.
- **Wake Lock** (screen stays on). The code only calls it when the browser
  supports it, and it wasn't observed on a real device.
- **Printing on paper.** Checked with print-media emulation in Chromium,
  not a printer or a PDF export.
- **Costs.** No pricing was looked up; the deployment section is an
  estimate.
- **The 100x section.** Projections only.
