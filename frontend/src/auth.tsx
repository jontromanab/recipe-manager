import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken } from "./api";
import type { Me } from "./types";

/** Stub sign-in: these tokens match the backend's seeded users (app/auth.py). */
export const DEMO_USERS = [
  { token: "bistro-editor", label: "Ana — Bistro Verde (editor)" },
  { token: "bistro-viewer", label: "Ben — Bistro Verde (viewer)" },
  { token: "harbor-editor", label: "Chloe — Harbor Grill (editor)" },
  { token: "harbor-viewer", label: "Dev — Harbor Grill (viewer)" },
];

const STORAGE_KEY = "recipe-manager.token";

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEMO_USERS[0].token;
  } catch {
    return DEMO_USERS[0].token;
  }
}

interface AuthState {
  me: Me | null;
  token: string;
  signInAs: (token: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState(readStored);
  const [me, setMe] = useState<Me | null>(null);

  // Set synchronously so child effects in this render already send the token.
  setToken(token);

  useEffect(() => {
    let cancelled = false;
    setMe(null);
    api.me().then((m) => !cancelled && setMe(m)).catch(() => !cancelled && setMe(null));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signInAs = (t: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* private mode: fine, just not remembered */
    }
    setTok(t);
  };

  return <AuthContext.Provider value={{ me, token, signInAs }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
