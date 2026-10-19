import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { parseTags } from "../lib/format";
import { toFieldErrors, type ErrorDetail, type FieldErrors } from "../lib/formErrors";
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
const isBlankRow = (r: IngredientRow) => !(r.name.trim() || r.quantity.trim() || r.unit.trim() || r.note.trim());

/** Build the API body, dropping blank rows. Also returns which screen row each sent row came from. */
function toInput(f: FormState): { data: RecipeInput; ingredientRows: number[]; stepRows: number[] } {
  const ingredientRows = f.ingredients.flatMap((r, i) => (isBlankRow(r) ? [] : [i]));
  const stepRows = f.steps.flatMap((s, i) => (s.trim() ? [i] : []));
  return {
    data: {
      title: f.title,
      tags: parseTags(f.tags),
      yield: { quantity: Number(f.yieldQuantity), unit: f.yieldUnit, portions: num(f.yieldPortions) },
      ingredients: ingredientRows.map((i) => {
        const r = f.ingredients[i];
        return { quantity: num(r.quantity), unit: r.unit || null, name: r.name, note: r.note || null };
      }),
      steps: stepRows.map((i) => f.steps[i]),
    },
    ingredientRows,
    stepRows,
  };
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A labelled input with its error message underneath. */
function Field({ label, hint, error, id, children }: {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label} {hint && <span className="muted">{hint}</span>}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error ? errorId : undefined })}
      {error && <span id={errorId} className="field-error">{error}</span>}
    </div>
  );
}

const INGREDIENT_COLS: [keyof IngredientRow, string][] = [
  ["quantity", "Quantity"],
  ["unit", "Unit"],
  ["name", "Ingredient"],
  ["note", "Prep note"],
];

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
  const err = (key: string): string | undefined => fieldErrors[key];

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
    setFieldErrors({});
    const { data, ingredientRows, stepRows } = toInput(form);
    try {
      const saved =
        recipeId === null ? await api.createRecipe(data) : await api.updateRecipe(recipeId, data, version!);
      navigate(`/recipes/${saved.id}`);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(apiError);
      const details = (apiError.extra?.details as ErrorDetail[] | undefined) ?? [];
      setFieldErrors(toFieldErrors(details, ingredientRows, stepRows));
      window.scrollTo({ top: 0, behavior: "smooth" }); // the error summary is at the top
    } finally {
      setSaving(false);
    }
  };

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

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
          {hasFieldErrors ? "Please fix the highlighted fields." : error.message}
        </div>
      )}

      <Field label="Title" id="title" error={err("title")}>
        {(p) => <input {...p} value={form.title} onChange={(e) => set("title", e.target.value)} />}
      </Field>

      <Field label="Tags" hint="(comma-separated)" id="tags" error={err("tags")}>
        {(p) => <input {...p} value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="sauce, cold station" />}
      </Field>

      <fieldset className="row">
        <legend>Yield</legend>
        <Field label="Amount" id="yield-quantity" error={err("yield.quantity") ?? err("yield")}>
          {(p) => <input {...p} type="number" min="0" step="any" value={form.yieldQuantity} onChange={(e) => set("yieldQuantity", e.target.value)} />}
        </Field>
        <Field label="Unit" id="yield-unit" error={err("yield.unit")}>
          {(p) => <input {...p} value={form.yieldUnit} onChange={(e) => set("yieldUnit", e.target.value)} placeholder="quart" />}
        </Field>
        <Field label="Portions" hint="(optional)" id="yield-portions" error={err("yield.portions")}>
          {(p) => <input {...p} type="number" min="0" step="any" value={form.yieldPortions} onChange={(e) => set("yieldPortions", e.target.value)} />}
        </Field>
      </fieldset>

      <fieldset className={err("ingredients") ? "has-error" : ""}>
        <legend>Ingredients</legend>
        {err("ingredients") && <span className="field-error">{err("ingredients")}</span>}
        {form.ingredients.map((row, i) => {
          const rowErrors = INGREDIENT_COLS.flatMap(([key, label]) => {
            const m = err(`ingredients.${i}.${key}`);
            return m ? [`${label}: ${m}`] : [];
          });
          const errorId = `ingredient-${i}-error`;
          return (
            <div key={i}>
              <div className="ingredient-row">
                {INGREDIENT_COLS.map(([key, label]) => (
                  <input
                    key={key}
                    aria-label={`${label} ${i + 1}`}
                    placeholder={key === "quantity" ? "Qty" : label}
                    type={key === "quantity" ? "number" : "text"}
                    min={key === "quantity" ? "0" : undefined}
                    step={key === "quantity" ? "any" : undefined}
                    value={row[key]}
                    aria-invalid={!!err(`ingredients.${i}.${key}`)}
                    aria-describedby={err(`ingredients.${i}.${key}`) ? errorId : undefined}
                    onChange={(e) => setRow(i, { [key]: e.target.value })}
                  />
                ))}
                <div className="row-actions">
                  <button type="button" className="ghost" aria-label="Move up" onClick={() => set("ingredients", move(form.ingredients, i, i - 1))}>↑</button>
                  <button type="button" className="ghost" aria-label="Move down" onClick={() => set("ingredients", move(form.ingredients, i, i + 1))}>↓</button>
                  <button type="button" className="ghost" aria-label="Remove" onClick={() => set("ingredients", form.ingredients.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
              {rowErrors.length > 0 && <span id={errorId} className="field-error">{rowErrors.join(" · ")}</span>}
            </div>
          );
        })}
        <button type="button" onClick={() => set("ingredients", [...form.ingredients, emptyRow()])}>
          + Add ingredient
        </button>
      </fieldset>

      <fieldset className={err("steps") ? "has-error" : ""}>
        <legend>Steps</legend>
        {err("steps") && <span className="field-error">{err("steps")}</span>}
        {form.steps.map((step, i) => {
          const stepError = err(`steps.${i}`);
          return (
            <div key={i}>
              <div className="step-row">
                <span className="num">{i + 1}</span>
                <textarea
                  aria-label={`Step ${i + 1}`}
                  rows={2}
                  value={step}
                  aria-invalid={!!stepError}
                  aria-describedby={stepError ? `step-${i}-error` : undefined}
                  onChange={(e) => set("steps", form.steps.map((s, j) => (j === i ? e.target.value : s)))}
                />
                <div className="row-actions">
                  <button type="button" className="ghost" aria-label="Move up" onClick={() => set("steps", move(form.steps, i, i - 1))}>↑</button>
                  <button type="button" className="ghost" aria-label="Move down" onClick={() => set("steps", move(form.steps, i, i + 1))}>↓</button>
                  <button type="button" className="ghost" aria-label="Remove" onClick={() => set("steps", form.steps.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
              {stepError && <span id={`step-${i}-error`} className="field-error">{stepError}</span>}
            </div>
          );
        })}
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
