import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";
import RecipeEdit from "./RecipeEdit";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { createRecipe: vi.fn(), getRecipe: vi.fn(), updateRecipe: vi.fn() } };
});

vi.mock("../auth", () => ({
  useAuth: () => ({
    me: { id: "u1", name: "Ana", org_id: "bistro", org_name: "Bistro", role: "editor" },
    token: "t",
    signInAs: vi.fn(),
  }),
}));

function renderNewForm() {
  render(
    <MemoryRouter initialEntries={["/recipes/new"]}>
      <Routes>
        <Route path="/recipes/new" element={<RecipeEdit />} />
        <Route path="/recipes/:id" element={<p>Saved page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.createRecipe).mockReset();
});

describe("RecipeEdit", () => {
  it("shows API validation errors next to the right fields", async () => {
    const user = userEvent.setup();
    // The 2nd screen row is sent as ingredients[0], because the blank 1st row is dropped.
    vi.mocked(api.createRecipe).mockRejectedValue(
      new ApiError(422, "invalid_input", "Request validation failed", {
        details: [
          { loc: ["body", "title"], msg: "String should have at least 1 character" },
          { loc: ["body", "ingredients", 0, "name"], msg: "String should have at least 1 character" },
        ],
      }),
    );
    renderNewForm();

    await user.click(screen.getByRole("button", { name: "+ Add ingredient" }));
    await user.type(screen.getByLabelText("Quantity 2"), "2");
    await user.type(screen.getByLabelText("Step 1"), "Mix.");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");

    const title = screen.getByLabelText("Title");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Required");

    expect(screen.getByLabelText("Ingredient 2")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Ingredient 2")).toHaveAccessibleDescription("Ingredient: Required");
    expect(screen.getByLabelText("Ingredient 1")).toHaveAttribute("aria-invalid", "false");

    // Blank rows are not sent.
    expect(vi.mocked(api.createRecipe).mock.calls[0][0].ingredients).toHaveLength(1);
  });

  it("sends cleaned-up data and opens the saved recipe", async () => {
    const user = userEvent.setup();
    vi.mocked(api.createRecipe).mockResolvedValue({ id: 9 } as never);
    renderNewForm();

    await user.type(screen.getByLabelText("Title"), "Pesto");
    await user.type(screen.getByLabelText(/Tags/), " Sauce, SAUCE , cold station");
    await user.type(screen.getByLabelText("Unit"), "cup");
    await user.type(screen.getByLabelText("Quantity 1"), "2");
    await user.type(screen.getByLabelText("Unit 1"), "cup");
    await user.type(screen.getByLabelText("Ingredient 1"), "basil");
    await user.type(screen.getByLabelText("Step 1"), "Blend.");
    await user.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(await screen.findByText("Saved page")).toBeInTheDocument();
    expect(api.createRecipe).toHaveBeenCalledWith({
      title: "Pesto",
      tags: ["sauce", "cold station"],
      yield: { quantity: 1, unit: "cup", portions: null },
      ingredients: [{ quantity: 2, unit: "cup", name: "basil", note: null }],
      steps: ["Blend."],
    });
  });
});
