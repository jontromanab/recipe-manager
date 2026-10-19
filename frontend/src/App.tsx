import { Link, Route, Routes } from "react-router-dom";
import { DEMO_USERS, useAuth } from "./auth";
import RecipeEdit from "./pages/RecipeEdit";
import RecipeList from "./pages/RecipeList";
import RecipeView from "./pages/RecipeView";

export default function App() {
  const { me, token, signInAs } = useAuth();

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Recipes{me && <span className="org"> · {me.org_name}</span>}
        </Link>
        <label className="signin">
          <span className="sr-only">Signed in as</span>
          <select value={token} onChange={(e) => signInAs(e.target.value)}>
            {DEMO_USERS.map((u) => (
              <option key={u.token} value={u.token}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main>
        {/* key: remount pages on user switch so nothing from another org lingers */}
        <Routes key={token}>
          <Route path="/" element={<RecipeList />} />
          <Route path="/recipes/new" element={<RecipeEdit />} />
          <Route path="/recipes/:id" element={<RecipeView />} />
          <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
          <Route path="*" element={<p className="notice">Page not found. <Link to="/">Back to recipes</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
