import type { IngredientLine, Yield } from "../types";

// Units where cooks expect decimals (7.5 g), not fractions (7 ½ g).
const DECIMAL_UNITS = new Set(["g", "kg", "mg", "ml", "l", "%"]);

const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];
const TOLERANCE = 0.02;

function trimDecimal(n: number, places = 2): string {
  return String(Number(n.toFixed(places)));
}

/** 1.5 cup -> "1 ½", 0.333 -> "⅓", 7.5 g -> "7.5". */
export function formatQuantity(quantity: number | null, unit?: string | null): string {
  if (quantity === null || !Number.isFinite(quantity)) return "";
  if (unit && DECIMAL_UNITS.has(unit.toLowerCase())) return trimDecimal(quantity);

  const whole = Math.floor(quantity);
  const frac = quantity - whole;
  if (frac < TOLERANCE) return String(whole);
  if (1 - frac < TOLERANCE) return String(whole + 1);

  const match = FRACTIONS.find(([v]) => Math.abs(frac - v) < TOLERANCE);
  if (!match) return trimDecimal(quantity);
  return whole ? `${whole} ${match[1]}` : match[1];
}

/** Ingredient amount, e.g. "1 ½ cup". Empty for "to taste" lines. */
export function formatAmount(line: IngredientLine): string {
  return [formatQuantity(line.quantity, line.unit), line.quantity !== null ? line.unit : null]
    .filter(Boolean)
    .join(" ");
}

export function formatYield(y: Yield): string {
  const main = `${formatQuantity(y.quantity, y.unit)} ${y.unit}`;
  // "10 portion · 10 portions" says the same thing twice.
  if (y.portions === null || /^(portion|serving)s?$/i.test(y.unit)) return main;
  const p = trimDecimal(y.portions, 1);
  return `${main} · ${p} ${p === "1" ? "portion" : "portions"}`;
}

/** "Base, soup ,,SOUP" -> ["base", "soup"] (mirrors server normalisation). */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
