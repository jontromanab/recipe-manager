import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { formatAmount, formatYield } from "../lib/format";
import type { Recipe } from "../types";

const SCALES = [0.5, 1, 2, 3, 4];

function toggleIn(set: Set<number>, i: number): Set<number> {
  const next = new Set(set);
  next.has(i) ? next.delete(i) : next.add(i);
  return next;
}

/** Cook mode: large type, tap to check off ingredients and steps. */
export default function RecipeView() {
  const { id } = useParams();
  const recipeId = Number(id);
  const { me } = useAuth();
  const navigate = useNavigate();

  const [scale, setScale] = useState(1);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [doneIngredients, setDoneIngredients] = useState<Set<number>>(new Set());
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getRecipe(recipeId, scale)
      .then((r) => !cancelled && setRecipe(r))
      .catch((e: ApiError) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [recipeId, scale]);

  // Keep a tablet screen awake while cooking, where supported.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, []);

  if (error) {
    return (
      <p className="notice">
        {error.status === 404 ? "Recipe not found." : error.message} <Link to="/">Back to recipes</Link>
      </p>
    );
  }
  if (!recipe) return <p className="muted">Loading…</p>;

  // The highlighted step is the first one not yet checked off.
  const current = recipe.steps.findIndex((_, i) => !doneSteps.has(i));

  const remove = async () => {
    try {
      await api.deleteRecipe(recipe.id);
      navigate("/", { state: { deleted: { id: recipe.id, title: recipe.title } } });
    } catch (e) {
      setError(e as ApiError);
    }
  };

  return (
    <article className="cook">
      <header className="cook-header">
        <div>
          <Link to="/" className="back">
            ← All recipes
          </Link>
          <h1>{recipe.title}</h1>
          <p className="yield">
            Makes <strong>{formatYield(recipe.yield)}</strong>
            {scale !== 1 && <span className="scaled"> (×{scale})</span>}
          </p>
        </div>
        {me?.role === "editor" && (
          <div className="actions">
            {confirmingDelete ? (
              <div className="confirm" role="alertdialog" aria-label="Confirm delete">
                <span>Delete this recipe?</span>
                <button className="danger-solid" onClick={remove}>
                  Yes, delete
                </button>
                <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
              </div>
            ) : (
              <>
                <Link to={`/recipes/${recipe.id}/edit`} className="button">
                  Edit
                </Link>
                <button className="danger" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <div className="scale" role="group" aria-label="Scale recipe">
        <span>Scale</span>
        {SCALES.map((s) => (
          <button key={s} aria-pressed={s === scale} className={s === scale ? "selected" : ""} onClick={() => setScale(s)}>
            {s === 0.5 ? "½" : s}×
          </button>
        ))}
      </div>

      <div className="cook-body">
        <section>
          <h2>Ingredients</h2>
          <ul className="ingredients">
            {recipe.ingredients.map((line, i) => (
              <li key={i}>
                <button
                  className={`ingredient${doneIngredients.has(i) ? " done" : ""}`}
                  aria-pressed={doneIngredients.has(i)}
                  onClick={() => setDoneIngredients((s) => toggleIn(s, i))}
                >
                  <span className="amount">{formatAmount(line)}</span>{" "}
                  <span>
                    {line.name}
                    {line.note && <span className="note">, {line.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Method</h2>
          <ol className="steps">
            {recipe.steps.map((step, i) => (
              <li key={i}>
                <button
                  className={`step${i === current ? " current" : ""}${doneSteps.has(i) ? " done" : ""}`}
                  aria-pressed={doneSteps.has(i)}
                  onClick={() => setDoneSteps((s) => toggleIn(s, i))}
                >
                  <span className="num">
                    <span className="n">{i + 1}</span>
                  </span>{" "}
                  <span className="text">{step}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="step-nav">
            <button disabled={doneSteps.size === 0} onClick={() => setDoneSteps(new Set())}>
              Reset steps
            </button>
            {current === -1 ? (
              <span className="all-done">All steps done ✓</span>
            ) : (
              <button className="primary" onClick={() => setDoneSteps((s) => toggleIn(s, current))}>
                Done with step {current + 1} →
              </button>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}
