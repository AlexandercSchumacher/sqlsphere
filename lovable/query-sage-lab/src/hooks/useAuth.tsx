/**
 * LOCAL_MODE auth stub.
 *
 * Returns a fixed demo user immediately. There is no login flow, no Supabase
 * auth, no real session. Components that previously branched on `loading`
 * still work because we set loading=false synchronously.
 *
 * The shape mirrors the original Supabase-based hook so existing call sites
 * (e.g. `const { user, session, loading } = useAuth()`) stay unchanged.
 */

const DEMO_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "demo@sqlsphere.local",
  user_metadata: { name: "Demo User" },
  app_metadata: {},
  aud: "authenticated",
  created_at: new Date(0).toISOString(),
} as const;

const DEMO_SESSION = {
  access_token: "local-mode-demo",
  refresh_token: "local-mode-demo",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: DEMO_USER,
} as const;

export const useAuth = () => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: DEMO_USER as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: DEMO_SESSION as any,
    loading: false,
  };
};
