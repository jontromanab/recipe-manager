import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { parseTags } from "../lib/format";
import type { Recipe, RecipeInput } from "../types";

interface IngredientRow {
  quantity: string;
  unit: string;
  name: string;
  note: string;
}

interface FormState {
  title: string;
  tags: string;
  yieldQuantity: string;
  yieldUnit: string;
  yieldPortions: string;
  ingredients: IngredientRow[];
  steps: string[];
}

const emptyRow = (): IngredientRow => ({ quantity: "", unit: "", name: "", note: "" });

const EMPTY: FormState = {
  title: "",
  tags: "",
  yieldQuantity: "1",
  yieldUnit: "",
  yieldPortions: "",
  ingredients: [emptyRow()],
  steps: [""],
};

function fromRecipe(r: Recipe): FormState {
  return {
    title: r.title,
    tags: r.tags.join(", "),
    yieldQuantity: String(r.yield.quantity),
    yieldUnit: r.yield.unit,
    yieldPortions: r.yield.portions === null ? "" : String(r.yield.portions),
    ingredients: r.ingredients.map((l) => ({
      quantity: l.quantity === null ? "" : String(l.quantity),
      unit: l.unit ?? "",
      name: l.name,
      note: l.note ?? "",
    })),
    steps: [...r.steps],
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

function toInput(f: FormState): RecipeInput {
  return {
    title: f.title,
    tags: parseTags(f.tags),
    yield: { quantity: Number(f.yieldQuantity), unit: f.yieldUnit, portions: num(f.yieldPortions) },
    // Drop rows the cook left completely blank.
    ingredients: f.ingredients
      .filter((r) => r.name.trim() || r.quantity.trim() || r.unit.trim())
      .map((r) => ({ quantity: num(r.quantity), unit: r.unit || null, name: r.name, note: r.note || null })),
    steps: f.steps.filter((s) => s.trim()),
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function RecipeEdit() {
  const { id } = useParams();
  const recipeId = id ? Number(id) : null;
  const { me } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(recipeId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (recipeId === null) return;
    api
      .getRecipe(recipeId)
      .then((r) => {
        setForm(fromRecipe(r));
        setVersion(r.version);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [recipeId]);

  if (me && me.role !== "editor") {
    return <p className="notice">You have view-only access. <Link to="/">Back to recipes</Link></p>;
  }
  if (loading) return <p className="muted">Loading…</p>;
  if (error?.status === 404) return <p className="notice">Recipe not found. <Link to="/">Back</Link></p>;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setRow = (i: number, patch: Partial<IngredientRow>) =>
    set("ingredients", form.ingredients.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const reloadLatest = async () => {
    if (recipeId === null) return;
    const r = await api.getRecipe(recipeId);
    setForm(fromRecipe(r));
    setVersion(r.version);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved =
        recipeId === null
          ? await api.createRecipe(toInput(form))
          : await api.updateRecipe(recipeId, toInput(form), version!);
      navigate(`/recipes/${saved.id}`);
    } catch (err) {
      setError(err as ApiError);
      window.scrollTo({ top: 0, behavior: "smooth" }); // the error banner is at the top
    } finally {
      setSaving(false);
    }
  };

  const details = (error?.extra.details as { loc: (string | number)[]; msg: string }[] | undefined) ?? [];

  return (
    <form className="edit" onSubmit={submit} noValidate>
      <h1>{recipeId === null ? "New recipe" : "Edit recipe"}</h1>

      {error?.status === 409 && (
        <div className="banner warn" role="alert">
          Someone else saved this recipe while you were editing.
          <button type="button" onClick={reloadLatest}>
            Load their version (discards your changes)
          </button>
        </div>
      )}
      {error && error.status !== 409 && (
        <div className="error" role="alert">
          {error.message}
          {details.length > 0 && (
            <ul>
              {details.map((d, i) => (
                <li key={i}>
                  {d.loc.filter((p) => p !== "body").join(" › ")}: {d.msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label>
        Title
        <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
      </label>

      <label>
        <span>Tags <span className="muted">(comma-separated)</span></span>
        <input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="sauce, cold station" />
      </label>

      <fieldset className="row">
        <legend>Yield</legend>
        <label>
          Amount
          <input type="number" min="0" step="any" value={form.yieldQuantity} onChange={(e) => set("yieldQuantity", e.target.value)} />
        </label>
        <label>
          Unit
          <input value={form.yieldUnit} onChange={(e) => set("yieldUnit", e.target.value)} placeholder="quart" />
        </label>
        <label>
          <span>Portions <span className="muted">(optional)</span></span>
          <input type="number" min="0" step="any" value={form.yieldPortions} onChange={(e) => set("yieldPortions", e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Ingredients</legend>
        {form.ingredients.map((row, i) => (
          <div className="ingredient-row" key={i}>
            <input aria-label="Quantity" type="number" min="0" step="any" placeholder="Qty" value={row.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} />
            <input aria-label="Unit" placeholder="Unit" value={row.unit} onChange={(e) => setRow(i, { unit: e.target.value })} />
            <input aria-label="Ingredient" placeholder="Ingredient" value={row.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            <input aria-label="Prep note" placeholder="Prep note" value={row.note} onChange={(e) => setRow(i, { note: e.target.value })} />
            <div className="row-actions">
              <button type="button" className="ghost" aria-label="Move up" onClick={() => set("ingredients", move(form.ingredients, i, i - 1))}>↑</button>
              <button type="button" className="ghost" aria-label="Move down" onClick={() => set("ingredients", move(form.ingredients, i, i + 1))}>↓</button>
              <button type="button" className="ghost" aria-label="Remove" onClick={() => set("ingredients", form.ingredients.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => set("ingredients", [...form.ingredients, emptyRow()])}>
          + Add ingredient
        </button>
      </fieldset>

      <fieldset>
        <legend>Steps</legend>
        {form.steps.map((step, i) => (
          <div className="step-row" key={i}>
            <span className="num">{i + 1}</span>
            <textarea aria-label={`Step ${i + 1}`} rows={2} value={step} onChange={(e) => set("steps", form.steps.map((s, j) => (j === i ? e.target.value : s)))} />
            <div className="row-actions">
              <button type="button" className="ghost" aria-label="Move up" onClick={() => set("steps", move(form.steps, i, i - 1))}>↑</button>
              <button type="button" className="ghost" aria-label="Move down" onClick={() => set("steps", move(form.steps, i, i + 1))}>↓</button>
              <button type="button" className="ghost" aria-label="Remove" onClick={() => set("steps", form.steps.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => set("steps", [...form.steps, ""])}>
          + Add step
        </button>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save recipe"}
        </button>
        <Link to={recipeId === null ? "/" : `/recipes/${recipeId}`} className="button ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
