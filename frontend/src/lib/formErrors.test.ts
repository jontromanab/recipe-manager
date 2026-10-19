import { describe, expect, it } from "vitest";
import { friendlyMessage, toFieldErrors } from "./formErrors";

describe("toFieldErrors", () => {
  it("drops the 'body' prefix and joins the path", () => {
    expect(
      toFieldErrors([
        { loc: ["body", "title"], msg: "x" },
        { loc: ["body", "yield", "quantity"], msg: "y" },
      ]),
    ).toEqual({ title: "X", "yield.quantity": "Y" });
  });

  it("maps sent row numbers back to screen rows", () => {
    const errors = toFieldErrors(
      [
        { loc: ["body", "ingredients", 0, "name"], msg: "a" },
        { loc: ["body", "steps", 1], msg: "b" },
      ],
      [2, 3], // sent ingredient 0 is screen row 2
      [0, 4], // sent step 1 is screen row 4
    );
    expect(errors).toEqual({ "ingredients.2.name": "A", "steps.4": "B" });
  });

  it("keeps the first message per field", () => {
    expect(toFieldErrors([{ loc: ["title"], msg: "first" }, { loc: ["title"], msg: "second" }])).toEqual({
      title: "First",
    });
  });
});

describe("friendlyMessage", () => {
  it.each([
    ["String should have at least 1 character", "Required"],
    ["Input should be greater than 0", "Must be more than 0"],
    ["List should have at least 1 item after validation, not 0", "Add at least one"],
    ["Value error, tags must be at most 40 characters", "Tags must be at most 40 characters"],
  ])("%s -> %s", (input, expected) => {
    expect(friendlyMessage(input)).toBe(expected);
  });
});
