import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { formatAmount, formatYield } from "../lib/format";
import type { Recipe } from "../types";

const SCALES = [0.5, 1, 2, 3, 4];

/** Cook mode: large type, tap to check off ingredients and track the current step. */
export default function RecipeView() {
  const { id } = useParams();
  const recipeId = Number(id);
  const { me } = useAuth();
  const navigate = useNavigate();

  const [scale, setScale] = useState(1);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [currentStep, setCurrentStep] = useState(0);

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

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

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
            <Link to={`/recipes/${recipe.id}/edit`} className="button">
              Edit
            </Link>
            <button className="danger" onClick={remove}>
              Delete
            </button>
          </div>
        )}
      </header>

      <div className="scale" role="group" aria-label="Scale recipe">
        <span>Scale</span>
        {SCALES.map((s) => (
          <button key={s} className={s === scale ? "selected" : ""} onClick={() => setScale(s)}>
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
                <button className={`ingredient${checked.has(i) ? " done" : ""}`} onClick={() => toggle(i)}>
                  <span className="amount">{formatAmount(line)}</span>
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
                  className={`step${i === currentStep ? " current" : ""}${i < currentStep ? " done" : ""}`}
                  onClick={() => setCurrentStep(i)}
                >
                  <span className="num">{i + 1}</span>
                  <span>{step}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="step-nav">
            <button disabled={currentStep === 0} onClick={() => setCurrentStep((s) => s - 1)}>
              ← Previous step
            </button>
            <button
              className="primary"
              disabled={currentStep >= recipe.steps.length - 1}
              onClick={() => setCurrentStep((s) => s + 1)}
            >
              Next step →
            </button>
          </div>
        </section>
      </div>
    </article>
  );
}
