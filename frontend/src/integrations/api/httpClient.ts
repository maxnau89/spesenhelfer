const BASE = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_KEY = "wsai_auth_token";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const token = localStorage.getItem(TOKEN_KEY);
  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) reqHeaders["Authorization"] = `Bearer ${token}`;

  const init: RequestInit = { method, headers: reqHeaders };

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
      delete reqHeaders["Content-Type"];
      init.headers = reqHeaders;
    } else {
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(`${BASE}${url}`, init);
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new Error("Session abgelaufen");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const httpClient = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, options: Omit<RequestOptions, "method"> = {}) =>
    request<T>(url, { ...options, method: "POST" }),
  patch: <T>(url: string, options: Omit<RequestOptions, "method"> = {}) =>
    request<T>(url, { ...options, method: "PATCH" }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
