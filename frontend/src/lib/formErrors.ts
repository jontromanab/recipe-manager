/** Turn API validation details (422) into per-field messages for the edit form. */

export interface ErrorDetail {
  loc: (string | number)[];
  msg: string;
}

export type FieldErrors = Record<string, string>;

const FRIENDLY: [RegExp, string][] = [
  [/^String should have at least 1 character/, "Required"],
  [/^Field required/, "Required"],
  [/^Input should be greater than 0/, "Must be more than 0"],
  [/^Input should be a valid number/, "Enter a number"],
  [/^List should have at least 1 item/, "Add at least one"],
];

export function friendlyMessage(msg: string): string {
  const clean = msg.replace(/^Value error, /, "");
  const hit = FRIENDLY.find(([re]) => re.test(clean));
  return hit ? hit[1] : clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Keys look like "title", "yield.quantity", "ingredients.2.name", "steps.1".
 *
 * The form drops blank rows before sending, so the API's row numbers can differ
 * from the rows on screen. `ingredientRows[i]` / `stepRows[i]` give the screen
 * row for the i-th row that was sent.
 */
export function toFieldErrors(
  details: ErrorDetail[],
  ingredientRows: number[] = [],
  stepRows: number[] = [],
): FieldErrors {
  const out: FieldErrors = {};
  for (const d of details) {
    const loc = d.loc.filter((p) => p !== "body");
    if (typeof loc[1] === "number") {
      if (loc[0] === "ingredients") loc[1] = ingredientRows[loc[1]] ?? loc[1];
      if (loc[0] === "steps") loc[1] = stepRows[loc[1]] ?? loc[1];
    }
    const key = loc.join(".");
    if (key && !(key in out)) out[key] = friendlyMessage(d.msg);
  }
  return out;
}
