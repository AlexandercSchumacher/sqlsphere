/**
 * HTTP client for the SQLSphere FastAPI backend.
 *
 * In LOCAL_MODE, the frontend talks directly to the backend running on
 * localhost (or wherever VITE_BACKEND_URL points). The Supabase JS client
 * is no longer used for auth, database queries, or edge functions.
 *
 * Usage:
 *   import { api } from "@/lib/api";
 *   const conns = await api.connections.list();
 *
 * Errors are thrown as ApiError instances (HTTP status + response body).
 */

// Resolve the backend URL, in order of preference:
//   1. VITE_BACKEND_URL set at build time (e.g. the Cloudflare Pages
//      build hardcodes http://localhost:8000 there).
//   2. Otherwise fall back to the page's own origin, which is the
//      right answer when the docker-compose nginx serves both the
//      frontend and proxies backend routes from the same port.
const _envBackend = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "";
const _runtimeBackend = typeof window !== "undefined" ? window.location.origin : "http://localhost:8000";
const BACKEND_URL = (_envBackend && _envBackend.length > 0 ? _envBackend : _runtimeBackend).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

async function request<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  const url = new URL(BACKEND_URL + path);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed, `${init.method} ${path} -> ${res.status}`);
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Resource shapes (kept loose - the backend is the source of truth)
// ---------------------------------------------------------------------------

export interface Connection {
  id: string;
  name: string;
  type: string;
  connection_method: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  use_ssl: boolean | null;
  is_default: boolean | null;
  status: string | null;
  auth_method: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface QueryHistoryEntry {
  id: string;
  connection_id: string | null;
  sql_text: string;
  status: string;
  execution_time_ms: number | null;
  row_count: number | null;
  error_message: string | null;
  is_favorite: boolean;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface UserSettings {
  dark_mode: boolean;
  language: string;
}

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  is_demo: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const api = {
  health: () => request<{ status: string; local_mode: boolean }>("/api/health"),

  auth: {
    me: () => request<DemoUser>("/api/auth/me"),
  },

  connections: {
    list: () => request<Connection[]>("/api/connections"),
    get: (id: string) => request<Connection>(`/api/connections/${id}`),
    create: (payload: Partial<Connection> & { name: string; type: string; password?: string }) =>
      request<Connection>("/api/connections", { method: "POST", body: payload }),
    update: (id: string, payload: Partial<Connection> & { password?: string }) =>
      request<Connection>(`/api/connections/${id}`, { method: "PATCH", body: payload }),
    remove: (id: string) =>
      request<void>(`/api/connections/${id}`, { method: "DELETE" }),
    connect: (id: string) =>
      request<{ session_id: string; connection_id: string }>(
        `/api/connections/${id}/connect`,
        { method: "POST" },
      ),
  },

  session: {
    get: (sessionId: string) => request<unknown>(`/session/${sessionId}`),
    refresh: (sessionId: string) =>
      request<{ success: boolean; expires_at?: string }>(`/session/${sessionId}/refresh`, { method: "POST" }),
  },

  query: {
    run: (sessionId: string, sql: string) =>
      request<{
        success: boolean;
        sql: string;
        results: Record<string, unknown>[];
        columns: string[];
        row_count: number;
        execution_time_ms: number;
      }>("/query", { method: "POST", body: { session_id: sessionId, query: sql } }),
  },

  queryHistory: {
    list: (limit = 100) => request<QueryHistoryEntry[]>("/api/query-history", { query: { limit } }),
    create: (payload: {
      connection_id?: string;
      sql_text: string;
      status?: string;
      execution_time_ms?: number;
      row_count?: number;
      error_message?: string;
      title?: string;
    }) => request<{ id: string }>("/api/query-history", { method: "POST", body: payload }),
    update: (id: string, payload: { is_favorite?: boolean; title?: string }) =>
      request<{ updated: number }>(`/api/query-history/${id}`, { method: "PATCH", body: payload }),
    remove: (id: string) =>
      request<void>(`/api/query-history/${id}`, { method: "DELETE" }),
  },

  userSettings: {
    get: () => request<UserSettings>("/api/user-settings"),
    update: (payload: Partial<UserSettings>) =>
      request<UserSettings>("/api/user-settings", { method: "PUT", body: payload }),
  },

  subscription: {
    status: () => request<{ tier: string; active: boolean; is_demo: boolean }>("/api/subscription"),
  },

  userUsage: {
    get: () => request<{ tier: string; unlimited: boolean }>("/api/user-usage"),
  },

  chatSessions: {
    list: () => request<Array<{ id: string; name: string; connection_id: string | null }>>("/api/chat-sessions"),
  },
};

export const backendUrl = BACKEND_URL;
