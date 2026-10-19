export interface IngredientLine {
  quantity: number | null;
  unit: string | null;
  name: string;
  note: string | null;
}

export interface Yield {
  quantity: number;
  unit: string;
  portions: number | null;
}

export interface RecipeSummary {
  id: number;
  title: string;
  tags: string[];
  yield: Yield;
  version: number;
  updated_at: string;
}

export interface Recipe extends RecipeSummary {
  ingredients: IngredientLine[];
  steps: string[];
  created_at: string;
  scale_factor: number;
}

export interface RecipeInput {
  title: string;
  tags: string[];
  yield: Yield;
  ingredients: IngredientLine[];
  steps: string[];
}

export interface RecipePage {
  items: RecipeSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface Me {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  role: "viewer" | "editor";
}
