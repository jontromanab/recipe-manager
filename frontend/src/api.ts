import type { Me, Recipe, RecipeInput, RecipePage } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection.");
  }
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const { code = "error", message = res.statusText, ...extra } = body?.error ?? {};
    throw new ApiError(res.status, code, message, extra);
  }
  return body as T;
}

export const api = {
  me: () => request<Me>("/me"),

  listRecipes: (params: { q?: string; tag?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return request<RecipePage>(`/recipes?${qs}`);
  },

  getRecipe: (id: number, scale?: number) =>
    request<Recipe>(`/recipes/${id}${scale && scale !== 1 ? `?scale=${scale}` : ""}`),

  createRecipe: (data: RecipeInput) =>
    request<Recipe>("/recipes", { method: "POST", body: JSON.stringify(data) }),

  updateRecipe: (id: number, data: RecipeInput, version: number) =>
    request<Recipe>(`/recipes/${id}`, { method: "PUT", body: JSON.stringify({ ...data, version }) }),

  deleteRecipe: (id: number) => request<void>(`/recipes/${id}`, { method: "DELETE" }),

  restoreRecipe: (id: number) => request<Recipe>(`/recipes/${id}/restore`, { method: "POST" }),
};
