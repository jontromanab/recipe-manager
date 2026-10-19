# Architecture and design decisions

## Requirements recap

| Requirement | What it means for the design |
|---|---|
| 5,000–10,000 requests/day | About 0.1 req/s on average, maybe 5–10 req/s at a dinner-rush peak. One small process is enough. |
| At most 1,000 recipes | The whole dataset is a few MB. Indexes and search engines are optional. |
| Several dozen users across competing restaurants | Tenant isolation is the most important correctness property. |
| Easy to read in a kitchen | Large type, big tap targets, scaling, step tracking, screen stays on. |
| Edit and remove | Two cooks may edit at the same time, and accidental deletes should be recoverable. |

With this load, the main risks are not performance. They are data leaking
between restaurants, lost edits, and recipes that are hard to read on the
line. The design spends its effort there and keeps everything else simple.

## System overview

```
 Browser (tablet / phone / desktop)
        │  HTTPS
        ▼
 ┌──────────────┐   /api/*   ┌───────────────────────────────────────────┐
 │ nginx (web)  │ ─────────► │ FastAPI (api)                             │
 │ static React │            │  routers → auth deps → repository → DB    │
 └──────────────┘            │  scaling.py (pure)   errors.py (1 shape)  │
                             └──────────────────────┬────────────────────┘
                                                    ▼
                                         SQLite file (volume)
                                         or Postgres via DATABASE_URL
```

Two containers. nginx serves the built frontend and proxies `/api`, so the
browser sees one origin and CORS doesn't come into play in production.

## Key decisions

### 1. Tenant isolation in the repository, 404 for other tenants

Every recipe has an `org_id`. `RecipeRepository(session, org_id)` is the only
data-access path the routes use. Its `_scoped()` query always filters on
`org_id` and on `deleted_at IS NULL`. You can't construct the repository
without an org, and routes get the org from the authenticated user, never
from the request body or URL.

Another restaurant's recipe returns 404, not 403. A 403 would confirm that the
ID exists, which leaks information between competitors. Tests cover this for
every method (GET, PUT, DELETE, restore) and for search.

*Alternative considered:* Postgres row-level security. It's stronger, but it
would tie us to Postgres and is more setup than this scale needs. It would be
a good next step if the app moves to Postgres.

### 2. A recipe is one aggregate stored as JSON columns

Ingredients, steps and tags are JSON columns on the `recipes` row, not child
tables. A recipe is always read and saved whole, and order matters. With child
tables, every save becomes "delete all lines and reinsert" plus position
bookkeeping, for no benefit at 1,000 rows. Pydantic validates the structure on
the way in (quantity > 0 or empty for "to taste", non-empty names, at least one
ingredient and one step, size limits).

*Trade-off:* SQL can't easily answer "which recipes use more than 2 kg of
butter". If ingredient-level reporting (costing, allergens, inventory) becomes
a requirement, ingredients should move to their own table, ideally linked to
an ingredient catalog.

### 3. Search is a LIKE query on a denormalized column

On each write the repository builds `search_text` (lowercased title, tags and
ingredient names) and `tags_index` (`|sauce|cold station|`). Search splits the
query into words and requires every word to match (`LIKE %word%`). User input
is escaped so `%` and `_` are matched literally. The tag filter matches whole
tags only.

This works the same on SQLite and Postgres. For 1,000 rows a scan takes
microseconds. SQLite FTS5 or Postgres `tsvector` would add ranking and
stemming, but would break the one-line database swap.

### 4. Optimistic concurrency with a version number

Each recipe has a `version`. A `PUT` must send the version the client loaded.
If it doesn't match, the API returns **409** with `current_version`, and the UI
offers to load the other cook's version. The `version` column is also
SQLAlchemy's `version_id_col`, so the UPDATE runs with `WHERE version = :old`.
That catches a race between the check and the commit; there's a test for it.

Locking was not an option: a cook who opens the edit screen and walks away
would block everyone else.

### 5. Soft delete with restore

`DELETE` sets `deleted_at`. In the UI, Delete first asks "Delete this
recipe?" inline (no browser pop-up). After deleting, an **Undo** banner calls
`POST /restore`, as a second safety net. Deleted recipes behave as missing
(404) everywhere else. There's no
"trash" screen and no purge job; those come later if needed.

### 6. Scaling on the server, as a pure function

`GET /recipes/{id}?scale=2` or `?target_yield=24` returns the recipe with
quantities, yield and portions multiplied. The logic is in `scaling.py`, has
no I/O, and is unit tested. Doing it on the server means any future client
(printing, a POS integration) gets the same numbers.

Rules: the factor must be between 0.01 and 100, `scale` and `target_yield`
can't be combined, quantities are rounded to 3 decimals to remove float noise,
and "to taste" lines stay empty. **Units are never converted** (8 cups stays
8 cups, not 2 quarts). Unit conversion is easy to get wrong (volume vs weight,
ingredient densities) and was out of scope.

The frontend shows kitchen fractions (`1 ½ cup`, `⅓ tsp`) for US units and
plain decimals for metric (`7.5 g`).

### 7. Stub authentication behind one dependency

`auth.py` maps bearer tokens to fixed users, each with an org and a role
(`viewer` or `editor`). Routes only depend on `CurrentUser` or `EditorUser`.
Replacing the stub with real OIDC/JWT validation only changes this one file.
Missing or bad tokens get 401. Viewers get 403 on writes, which is fine
because they're inside their own org and the 403 leaks nothing.

### 8. One error shape

Every error, including FastAPI's validation errors, is returned as
`{"error": {"code", "message", ...extra}}`. The frontend has a single
`ApiError` type and shows field-level messages from `details`.

### 9. SQLite by default, Postgres by config

SQLite on a Docker volume is enough for this load and costs nothing to run or
back up (one file). `DATABASE_URL` switches to Postgres with no code changes.
Tables are created on startup instead of with Alembic migrations; the first
schema change after launch is when Alembic should come in.

**Cost:** one small VM or container host is enough. There's no managed
database to pay for at this size.

## Frontend

- **List:** search as you type (debounced 250 ms), tag chips, pagination. The
  query lives in the URL, so back/forward and shared links work.
- **Cook mode:** large type, two columns on tablets (ingredients stay on
  screen while steps scroll), one column on phones. Tap an ingredient to
  check it off. Steps work the same way, in any order; the first unchecked
  step is highlighted and a "Done with step N" button checks it off. Scale
  buttons from ½× to 4×. The screen is kept awake (Wake Lock API) where the
  browser supports it. Dark mode follows the system.
- **Edit:** structured rows for ingredients and steps with reorder and
  remove, and conflict handling. Validation errors from the API appear
  under the field they belong to. Because blank rows are dropped before
  sending, the form maps the API's row numbers back to the rows on screen
  (`lib/formErrors.ts`).
- **Print:** a print stylesheet turns cook mode into a black-on-white
  station card with no buttons, at the current scale.
- Switching user remounts all pages, so nothing from the previous
  restaurant stays on screen.

No state-management library; each page fetches what it needs. With three
screens, React Query or Redux would add more than it saves.

## Testing strategy

| Layer | Where | What |
|---|---|---|
| Pure logic | `test_scaling.py`, `test_schemas.py`, `format.test.ts`, `formErrors.test.ts` | scaling math and limits, validation rules, quantity formatting, error-to-field mapping |
| Components | `RecipeView.test.tsx`, `RecipeEdit.test.tsx` (React Testing Library) | step check-off, scale request, delete confirmation, viewer can't see edit/delete, inline field errors on the right row, cleaned-up form data |
| Data access | `test_repository.py` | tenant isolation, soft delete and restore, version conflicts including the race, search (title, ingredient, tag, multi-word, wildcard escaping), pagination |
| HTTP | `test_api_recipes.py` | auth (401/403), full CRUD round trip, 404 for every method on other orgs, 409 body, 422 details, query-param limits, scaling endpoint, seed idempotence |
| End to end | `e2e/smoke_test.py` | real browser against `docker compose`: search, scaling, conflict, inline validation, delete confirm and undo, print layout, switching orgs, phone layout |

Each backend test gets a fresh in-memory SQLite database through
`create_app(Settings(database_url="sqlite://"))`, so tests are isolated and
the whole suite runs in about 1.5 s.

## What I'd do next

1. Real auth (OIDC), with users and orgs stored in the database and an admin
   role to manage them.
2. Postgres in production, Alembic migrations, and row-level security as a
   second line of defense for tenant isolation.
3. Change history: store each version so a chef can see who changed what and
   roll back.
4. Ingredient catalog and unit conversion, which would enable costing and
   allergen tags.
5. Print view (a station card), photos, and offline caching for kitchens
   with bad Wi-Fi.
6. Observability: structured logs with org and user, request metrics, and
   error tracking.

## Out of scope on purpose

Internationalization (per the brief), unit conversion, images, real
authentication, rate limiting, and a CI pipeline. The test commands are
simple enough to drop into one.
