/**
 * LOCAL_MODE Supabase shim.
 *
 * The original code imports from '@supabase/supabase-js' and uses three
 * surfaces of the client:
 *
 *   1. supabase.auth.*        - sign in / out / session listener
 *   2. supabase.functions.*   - call cloud edge functions
 *   3. supabase.from(...).*   - PostgREST-style table queries
 *
 * In LOCAL_MODE there is no Supabase. This file ships an in-process
 * stub that mimics those surfaces just well enough for the existing
 * pages to keep compiling and behaving sensibly:
 *
 *   - Auth always reports the fixed demo user as signed-in.
 *   - functions.invoke('database-proxy', { body: { endpoint, ... }})
 *     is rewritten as a POST to ${BACKEND_URL}${endpoint} (this is
 *     exactly what the original edge function did server-side).
 *   - functions.invoke('manage-connection', ...) maps onto the
 *     /api/connections REST endpoints.
 *   - functions.invoke('check-subscription' | 'send-contact-email')
 *     returns harmless stub responses.
 *   - .from('table_name').select()/insert()/update()/delete() returns
 *     no-op chains; pages that still rely on direct table access will
 *     get empty results and a console warning. Those pages should be
 *     migrated to the typed `api` client in @/lib/api.
 *
 * This shim is intentionally narrow. It is enough to keep the demo
 * functional without a 24-file rewrite. Anything not covered should
 * be moved to @/lib/api.
 */

import { backendUrl } from "@/lib/api";

type SupabaseInvokeArgs = {
  body?: unknown;
  headers?: Record<string, string>;
};

type SupabaseInvokeResult<T = unknown> = {
  data: T | null;
  error: { message: string; status?: number } | null;
};

const DEMO_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "demo@sqlsphere.local",
  user_metadata: { name: "Demo User" },
  app_metadata: {},
  aud: "authenticated",
  created_at: new Date(0).toISOString(),
};

const DEMO_SESSION = {
  access_token: "local-mode-demo",
  refresh_token: "local-mode-demo",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: DEMO_USER,
};

// ---------------------------------------------------------------------------
// functions.invoke
// ---------------------------------------------------------------------------

async function invokeDatabaseProxy(
  body: Record<string, unknown>,
  callerHeaders?: Record<string, string>,
): Promise<SupabaseInvokeResult> {
  const endpoint = (body.endpoint as string | undefined) ?? "/";
  const { endpoint: _endpoint, method, ...rest } = body as Record<string, unknown> & { method?: string };
  const httpMethod = (method as string | undefined) ?? "POST";

  const isReadOnlyGet = httpMethod.toUpperCase() === "GET";
  const url = backendUrl + endpoint;

  try {
    const init: RequestInit = {
      method: httpMethod,
      headers: { "Content-Type": "application/json", ...(callerHeaders ?? {}) },
    };
    if (!isReadOnlyGet && Object.keys(rest).length > 0) {
      init.body = JSON.stringify(rest);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      return {
        data: null,
        error: {
          message:
            (parsed as { detail?: string; error?: string } | null)?.detail ??
            (parsed as { error?: string } | null)?.error ??
            `HTTP ${res.status}`,
          status: res.status,
        },
      };
    }
    return { data: parsed, error: null };
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
}

async function invokeManageConnection(body: Record<string, unknown>): Promise<SupabaseInvokeResult> {
  const action = body.action as string | undefined;
  const id = body.id as string | undefined;
  const payload = (body.payload ?? body.data ?? body) as Record<string, unknown>;

  if (action === "list" || (!action && !id)) {
    return invokeDatabaseProxy({ endpoint: "/api/connections", method: "GET" });
  }
  if (action === "get" && id) {
    return invokeDatabaseProxy({ endpoint: `/api/connections/${id}`, method: "GET" });
  }
  if (action === "create" || (!action && !id && body.name)) {
    return invokeDatabaseProxy({ endpoint: "/api/connections", method: "POST", ...payload });
  }
  if (action === "update" && id) {
    return invokeDatabaseProxy({ endpoint: `/api/connections/${id}`, method: "PATCH", ...payload });
  }
  if (action === "delete" && id) {
    return invokeDatabaseProxy({ endpoint: `/api/connections/${id}`, method: "DELETE" });
  }
  return { data: null, error: { message: `manage-connection: unknown action "${action}"` } };
}

const functions = {
  async invoke<T = unknown>(name: string, args: SupabaseInvokeArgs = {}): Promise<SupabaseInvokeResult<T>> {
    const body = (args.body ?? {}) as Record<string, unknown>;
    const headers = args.headers;

    if (name === "database-proxy") {
      return invokeDatabaseProxy(body, headers) as Promise<SupabaseInvokeResult<T>>;
    }
    if (name === "manage-connection") {
      return invokeManageConnection(body) as Promise<SupabaseInvokeResult<T>>;
    }
    if (name === "check-subscription") {
      return {
        data: { subscribed: true, tier: "demo", product_id: null, price_id: null, subscription_end: null } as T,
        error: null,
      };
    }
    if (name === "send-contact-email") {
      console.warn("[LOCAL_MODE] Contact form submissions are disabled.");
      return { data: { success: false, reason: "disabled-in-local-mode" } as T, error: null };
    }
    if (name === "create-checkout" || name === "customer-portal") {
      return { data: null, error: { message: "Stripe billing is not available in LOCAL_MODE." } };
    }
    if (name === "test-connection") {
      // Original test-connection forwarded to FastAPI /connect with raw params.
      return invokeDatabaseProxy({ endpoint: "/connect", ...body }) as Promise<SupabaseInvokeResult<T>>;
    }
    return { data: null, error: { message: `LOCAL_MODE: edge function "${name}" not available.` } };
  },
};

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

const auth = {
  async getSession() {
    return { data: { session: DEMO_SESSION }, error: null };
  },
  async getUser() {
    return { data: { user: DEMO_USER }, error: null };
  },
  async signOut() {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("sqlsphere_")) localStorage.removeItem(k);
    });
    return { error: null };
  },
  async signInWithPassword() {
    return { data: { session: DEMO_SESSION, user: DEMO_USER }, error: null };
  },
  async signInWithOAuth() {
    return { data: null, error: { message: "OAuth is not available in LOCAL_MODE." } };
  },
  async signUp() {
    return { data: { session: DEMO_SESSION, user: DEMO_USER }, error: null };
  },
  async resetPasswordForEmail() {
    return { data: null, error: { message: "Password reset is not available in LOCAL_MODE." } };
  },
  async updateUser() {
    return { data: { user: DEMO_USER }, error: null };
  },
  onAuthStateChange(_cb: unknown) {
    return { data: { subscription: { unsubscribe() {} } } };
  },
};

// ---------------------------------------------------------------------------
// from(...) - empty PostgREST-style chain. Pages that still rely on direct
// table access via `.from('connections').select()...` should migrate to
// the typed @/lib/api client. The chain below returns no-op promises so
// the remaining call sites keep compiling and don't throw.
// ---------------------------------------------------------------------------

interface QueryBuilder {
  select: (..._args: unknown[]) => QueryBuilder;
  insert: (..._args: unknown[]) => QueryBuilder;
  update: (..._args: unknown[]) => QueryBuilder;
  delete: (..._args: unknown[]) => QueryBuilder;
  upsert: (..._args: unknown[]) => QueryBuilder;
  eq: (..._args: unknown[]) => QueryBuilder;
  neq: (..._args: unknown[]) => QueryBuilder;
  gt: (..._args: unknown[]) => QueryBuilder;
  gte: (..._args: unknown[]) => QueryBuilder;
  lt: (..._args: unknown[]) => QueryBuilder;
  lte: (..._args: unknown[]) => QueryBuilder;
  ilike: (..._args: unknown[]) => QueryBuilder;
  like: (..._args: unknown[]) => QueryBuilder;
  in: (..._args: unknown[]) => QueryBuilder;
  is: (..._args: unknown[]) => QueryBuilder;
  order: (..._args: unknown[]) => QueryBuilder;
  limit: (..._args: unknown[]) => QueryBuilder;
  range: (..._args: unknown[]) => QueryBuilder;
  single: (..._args: unknown[]) => QueryBuilder;
  maybeSingle: (..._args: unknown[]) => QueryBuilder;
  then: (
    onfulfilled?: (value: { data: unknown; error: null; count?: number }) => unknown,
    onrejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

const NOOP_RESULT = { data: null, error: null, count: 0 };

function makeQueryBuilder(): QueryBuilder {
  const builder: Partial<QueryBuilder> = {};
  const noop = () => builder as QueryBuilder;
  ["select", "insert", "update", "delete", "upsert", "eq", "neq", "gt", "gte", "lt", "lte", "ilike", "like", "in", "is", "order", "limit", "range", "single", "maybeSingle"].forEach((m) => {
    (builder as Record<string, unknown>)[m] = noop;
  });
  builder.then = (onfulfilled, onrejected) => Promise.resolve(NOOP_RESULT).then(onfulfilled, onrejected);
  return builder as QueryBuilder;
}

const noopChannel = {
  on() { return this; },
  subscribe() { return Promise.resolve("SUBSCRIBED"); },
  unsubscribe() { return Promise.resolve("CLOSED"); },
};

export const supabase = {
  auth,
  functions,
  from(_table: string) {
    return makeQueryBuilder();
  },
  rpc(_fn: string, _params?: Record<string, unknown>): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: null, error: null });
  },
  storage: {
    from(_bucket: string) {
      return {
        async download(_path: string) {
          return { data: null, error: { message: "Storage is not available in LOCAL_MODE." } };
        },
        async upload(_path: string, _file: unknown) {
          return { data: null, error: { message: "Storage is not available in LOCAL_MODE." } };
        },
        async remove(_paths: string[]) {
          return { data: null, error: { message: "Storage is not available in LOCAL_MODE." } };
        },
        getPublicUrl(_path: string) {
          return { data: { publicUrl: "" } };
        },
      };
    },
  },
  channel(_name: string) {
    return noopChannel;
  },
  removeChannel() {},
};
