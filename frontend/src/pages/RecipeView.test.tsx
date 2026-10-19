import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Me, Recipe } from "../types";
import RecipeView from "./RecipeView";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { getRecipe: vi.fn(), deleteRecipe: vi.fn() } };
});

let me: Me;
vi.mock("../auth", () => ({ useAuth: () => ({ me, token: "t", signInAs: vi.fn() }) }));

const RECIPE: Recipe = {
  id: 7,
  title: "Test Soup",
  tags: ["soup"],
  yield: { quantity: 2, unit: "quart", portions: 8 },
  ingredients: [
    { quantity: 1.5, unit: "cup", name: "onion", note: "diced" },
    { quantity: null, unit: null, name: "salt", note: "to taste" },
  ],
  steps: ["Chop the onions.", "Simmer 20 minutes.", "Season."],
  version: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  scale_factor: 1,
};

function renderView() {
  render(
    <MemoryRouter initialEntries={["/recipes/7"]}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeView />} />
        <Route path="/" element={<p>List page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole("heading", { name: "Test Soup" });
}

beforeEach(() => {
  vi.mocked(api.getRecipe).mockReset().mockResolvedValue(RECIPE);
  vi.mocked(api.deleteRecipe).mockReset().mockResolvedValue(undefined);
  me = { id: "u1", name: "Ana", org_id: "bistro", org_name: "Bistro", role: "editor" };
});

describe("RecipeView (cook mode)", () => {
  it("shows kitchen-friendly quantities", async () => {
    await renderView();
    expect(screen.getByRole("button", { name: /^1 ½ cup onion\s*, diced$/ })).toBeInTheDocument();
    expect(screen.getByText("2 quart · 8 portions")).toBeInTheDocument();
  });

  it("taps a step to check it off, and again to uncheck it", async () => {
    const user = userEvent.setup();
    await renderView();
    const first = screen.getByRole("button", { name: /Chop the onions/ });

    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Done with step 1 →" })).toBeInTheDocument();

    await user.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Done with step 2 →" })).toBeInTheDocument();

    await user.click(first);
    expect(first).toHaveAttribute("aria-pressed", "false");
  });

  it("checks steps off in any order and says when all are done", async () => {
    const user = userEvent.setup();
    await renderView();
    await user.click(screen.getByRole("button", { name: /Season/ }));
    expect(screen.getByRole("button", { name: "Done with step 1 →" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done with step 1 →" }));
    await user.click(screen.getByRole("button", { name: "Done with step 2 →" }));
    expect(screen.getByText("All steps done ✓")).toBeInTheDocument();
  });

  it("asks the server for a scaled recipe", async () => {
    const user = userEvent.setup();
    await renderView();
    await user.click(screen.getByRole("button", { name: "2×" }));
    expect(api.getRecipe).toHaveBeenLastCalledWith(7, 2);
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    await renderView();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this recipe?")).toBeInTheDocument();
    expect(api.deleteRecipe).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete this recipe?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(api.deleteRecipe).toHaveBeenCalledWith(7);
    expect(await screen.findByText("List page")).toBeInTheDocument();
  });

  it("hides edit and delete from viewers", async () => {
    me = { ...me, role: "viewer" };
    await renderView();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});
