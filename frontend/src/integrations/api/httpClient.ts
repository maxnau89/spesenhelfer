const BASE = import.meta.env.VITE_API_BASE_URL || "";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };

  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
      delete (init.headers as Record<string, string>)["Content-Type"];
    } else {
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(`${BASE}${url}`, init);
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
