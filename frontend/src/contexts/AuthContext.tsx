import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { msalInstance, msalReady, loginRequest } from "@/lib/msalConfig";

const WSAI_API = "https://platform.alphatransition.com";
const TOKEN_KEY = "wsai_auth_token";

interface AuthState {
  token: string | null;
  email: string | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginMicrosoft: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    email: null,
    isLoading: true,
  });

  useEffect(() => {
    const init = async () => {
      // Clear any stale MSAL interaction lock (e.g. from a previous loginRedirect attempt)
      try {
        await msalReady;
        await msalInstance.handleRedirectPromise();
      } catch { /* ignore */ }

      // Check stored JWT
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        try {
          const payload = JSON.parse(atob(stored.split(".")[1]));
          if (payload.exp * 1000 > Date.now()) {
            setState({ token: stored, email: payload.sub, isLoading: false });
            return;
          }
        } catch {}
        localStorage.removeItem(TOKEN_KEY);
      }

      setState({ token: null, email: null, isLoading: false });
    };
    init();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${WSAI_API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Login fehlgeschlagen");
    }
    const data = await res.json();
    _applyToken(data.access_token, setState);
  };

  const loginMicrosoft = async () => {
    await msalReady;
    // Popup flow — result comes back directly, no redirect needed.
    // Uses the registered auth-popup.html URI (same as wsai app).
    const result = await msalInstance.loginPopup({
      ...loginRequest,
      redirectUri: `${window.location.origin}/auth-popup.html`,
    });
    if (!result?.idToken) throw new Error("Kein ID-Token erhalten");
    const res = await fetch(`${WSAI_API}/auth/microsoft/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: result.idToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Verifizierung fehlgeschlagen");
    }
    const data = await res.json();
    _applyToken(data.access_token, setState);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ token: null, email: null, isLoading: false });
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAuthenticated: !!state.token && !state.isLoading,
        login,
        loginMicrosoft,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function _applyToken(token: string, setState: React.Dispatch<React.SetStateAction<AuthState>>) {
  const payload = JSON.parse(atob(token.split(".")[1]));
  localStorage.setItem(TOKEN_KEY, token);
  setState({ token, email: payload.sub, isLoading: false });
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
