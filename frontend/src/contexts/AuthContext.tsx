import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

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
  setTokenFromMicrosoft: (idToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: localStorage.getItem(TOKEN_KEY),
    email: null,
    isLoading: true,
  });

  // Verify stored token on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }
    // Decode payload client-side (no signature check needed here — backend validates)
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp * 1000 < Date.now()) {
        // Expired
        localStorage.removeItem(TOKEN_KEY);
        setState({ token: null, email: null, isLoading: false });
      } else {
        setState({ token, email: payload.sub, isLoading: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState({ token: null, email: null, isLoading: false });
    }
  }, []);

  const _applyToken = (token: string) => {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      localStorage.setItem(TOKEN_KEY, token);
      setState({ token, email: payload.sub, isLoading: false });
    } catch {
      throw new Error("Invalid token received");
    }
  };

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
    _applyToken(data.access_token);
  };

  const setTokenFromMicrosoft = async (idToken: string) => {
    const res = await fetch(`${WSAI_API}/auth/microsoft/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Auth fehlgeschlagen: ${res.status}`);
    }
    const data = await res.json();
    _applyToken(data.access_token);
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
        setTokenFromMicrosoft,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
