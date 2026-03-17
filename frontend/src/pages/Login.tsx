import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { loginRequest, msalInstance, msalReady } from "@/lib/msalConfig";

export function Login() {
  const { login, setTokenFromMicrosoft } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoft = async () => {
    setMsLoading(true);
    setError(null);
    try {
      await msalReady;
      // Clear stale MSAL interaction state
      for (const key of Object.keys(sessionStorage)) {
        if (key.includes("msal") && (key.includes("interaction") || key.includes("request"))) {
          sessionStorage.removeItem(key);
        }
      }
      const result = await msalInstance.loginPopup({
        ...loginRequest,
        redirectUri: `${window.location.origin}/auth-popup.html`,
      });
      if (!result?.idToken) throw new Error("Kein ID-Token von Microsoft");
      await setTokenFromMicrosoft(result.idToken);
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err?.errorCode === "user_cancelled" || err?.message?.includes("user_cancelled")) return;
      setError(err.message || "Microsoft-Login fehlgeschlagen");
    } finally {
      setMsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold">Spesenhelfer</h1>
          <p className="text-sm text-muted-foreground mt-1">Mit AlphaTransition-Konto anmelden</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1">E-Mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading || msLoading}
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="name@lbbwvc.de"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Passwort</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || msLoading}
              className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading || msLoading}
            className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            {loading ? "Anmelden..." : "Anmelden"}
          </button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-2 text-muted-foreground">oder</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleMicrosoft}
          disabled={loading || msLoading}
          className="w-full flex items-center justify-center gap-2 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {msLoading ? (
            <span>Weiterleitung zu Microsoft...</span>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Mit Microsoft anmelden
            </>
          )}
        </button>
      </div>
    </div>
  );
}
