import { useAuthStore } from "../auth/store";

const BASE_URL = "https://bigmiles.app";

export async function apiRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" = "GET",
  body?: unknown
): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Token expired or revoked — clear auth state
    useAuthStore.getState().logout();
  }

  return res;
}

export async function apiJson<T>(
  path: string,
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  body?: unknown
): Promise<T> {
  const res = await apiRequest(path, method, body);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}
