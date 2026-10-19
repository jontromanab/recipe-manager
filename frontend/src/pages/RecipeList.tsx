import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { formatYield } from "../lib/format";
import type { RecipePage } from "../types";

const PAGE_SIZE = 12;

export default function RecipeList() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const q = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);

  const [draft, setDraft] = useState(q);
  const [data, setData] = useState<RecipePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ id: number; title: string } | null>(
    (location.state as { deleted?: { id: number; title: string } } | null)?.deleted ?? null,
  );

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? merged.set(k, v) : merged.delete(k);
    setParams(merged, { replace: true });
  };

  // Debounce typing into the URL (which drives the fetch).
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => update({ q: draft, page: "" }), 250);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listRecipes({ q, tag, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((d) => !cancelled && setData(d))
      .catch((e: ApiError) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [q, tag, page]);

  const undoDelete = async () => {
    if (!deleted) return;
    try {
      await api.restoreRecipe(deleted.id);
      navigate(`/recipes/${deleted.id}`);
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const pages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <section>
      {deleted && (
        <div className="banner" role="status">
          Deleted “{deleted.title}”.
          <button onClick={undoDelete}>Undo</button>
          <button className="ghost" onClick={() => setDeleted(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search title, ingredient or tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Search recipes"
        />
        {me?.role === "editor" && (
          <Link to="/recipes/new" className="button primary">
            + New recipe
          </Link>
        )}
      </div>

      {tag && (
        <p className="filter">
          Tag: <span className="tag">{tag}</span>
          <button className="ghost" onClick={() => update({ tag: "", page: "" })}>
            clear
          </button>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && data.items.length === 0 && (
        <p className="muted">{q || tag ? "No recipes match." : "No recipes yet."}</p>
      )}

      <ul className="cards">
        {data?.items.map((r) => (
          <li key={r.id} className="card">
            <Link to={`/recipes/${r.id}`} className="card-link">
              <h2>{r.title}</h2>
              <p className="muted">{formatYield(r.yield)}</p>
            </Link>
            <div className="tags">
              {r.tags.map((t) => (
                <button key={t} className="tag" onClick={() => update({ tag: t, page: "" })}>
                  {t}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav className="pager">
          <button disabled={page === 0} onClick={() => update({ page: String(page - 1) })}>
            ← Prev
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) })}>
            Next →
          </button>
        </nav>
      )}
    </section>
  );
}
