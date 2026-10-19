import { describe, expect, it } from "vitest";
import { formatAmount, formatQuantity, formatYield, parseTags } from "./format";

describe("formatQuantity", () => {
  it.each([
    [null, "cup", ""],
    [2, "cup", "2"],
    [0.5, "cup", "½"],
    [1.5, "cup", "1 ½"],
    [0.333, "cup", "⅓"],
    [0.667, "tbsp", "⅔"],
    [2.75, null, "2 ¾"],
    [1.999, "cup", "2"],
    [0.4, "cup", "0.4"], // no close fraction
    [7.5, "g", "7.5"], // metric stays decimal
    [1.25, "kg", "1.25"],
    [1000, "G", "1000"],
  ])("%s %s -> %s", (q, unit, expected) => {
    expect(formatQuantity(q, unit)).toBe(expected);
  });
});

describe("formatAmount", () => {
  it("joins quantity and unit", () => {
    expect(formatAmount({ quantity: 1.5, unit: "cup", name: "oil", note: null })).toBe("1 ½ cup");
  });
  it("is empty for to-taste lines", () => {
    expect(formatAmount({ quantity: null, unit: "pinch", name: "salt", note: "to taste" })).toBe("");
  });
  it("handles quantity without unit", () => {
    expect(formatAmount({ quantity: 3, unit: null, name: "eggs", note: null })).toBe("3");
  });
});

describe("formatYield", () => {
  it("with portions", () => {
    expect(formatYield({ quantity: 4, unit: "quart", portions: 16 })).toBe("4 quart · 16 portions");
  });
  it("singular portion", () => {
    expect(formatYield({ quantity: 1, unit: "tart", portions: 1 })).toBe("1 tart · 1 portion");
  });
  it("does not repeat portions when the unit already is portions", () => {
    expect(formatYield({ quantity: 10, unit: "portions", portions: 10 })).toBe("10 portions");
  });
  it("without portions", () => {
    expect(formatYield({ quantity: 0.5, unit: "cup", portions: null })).toBe("½ cup");
  });
});

describe("parseTags", () => {
  it("trims, lowercases and dedupes", () => {
    expect(parseTags(" Base, soup ,,SOUP")).toEqual(["base", "soup"]);
  });
  it("empty input", () => {
    expect(parseTags("")).toEqual([]);
  });
});
