/**
 * Browser-side storage for the user's Anthropic / OpenAI API keys.
 *
 * In LOCAL_MODE there is no real auth and no real backend that can hold
 * secrets per-user. Instead, the recruiter pastes their own AI key into
 * a small dialog, the key is persisted in localStorage, and every chat
 * request forwards it to the backend via X-Anthropic-Key / X-OpenAI-Key
 * headers. The backend prefers those headers over its own env vars.
 *
 * Security model:
 *   - The key never leaves the recruiter's machine. The "backend" it is
 *     sent to is the FastAPI container running locally via docker compose.
 *     That container then talks to Anthropic / OpenAI directly.
 *   - localStorage is plaintext, but the threat model is single-user
 *     (the recruiter's own browser). XSS would be a concern in a
 *     multi-tenant app; this isn't one.
 */

export type LlmProvider = "anthropic" | "openai";

export const LLM_KEY_STORAGE = {
  anthropic: "sqlsphere_anthropic_key",
  openai: "sqlsphere_openai_key",
  active: "sqlsphere_active_llm",
} as const;

export interface StoredLlmKeys {
  anthropic: string;
  openai: string;
  active: LlmProvider | null;
}

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode -> silently ignore */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getStoredLlmKeys(): StoredLlmKeys {
  const anthropic = safeGet(LLM_KEY_STORAGE.anthropic);
  const openai = safeGet(LLM_KEY_STORAGE.openai);
  const active = safeGet(LLM_KEY_STORAGE.active) as LlmProvider | "";
  return {
    anthropic,
    openai,
    active: active === "anthropic" || active === "openai" ? active : null,
  };
}

export function setLlmKey(provider: LlmProvider, key: string): void {
  if (!key.trim()) return;
  safeSet(LLM_KEY_STORAGE[provider], key.trim());
  safeSet(LLM_KEY_STORAGE.active, provider);
}

export function clearLlmKey(provider: LlmProvider): void {
  safeRemove(LLM_KEY_STORAGE[provider]);
  // If the cleared provider was active, fall back to the other if it exists.
  const stored = getStoredLlmKeys();
  if (stored.active === provider) {
    if (provider === "anthropic" && stored.openai) {
      safeSet(LLM_KEY_STORAGE.active, "openai");
    } else if (provider === "openai" && stored.anthropic) {
      safeSet(LLM_KEY_STORAGE.active, "anthropic");
    } else {
      safeRemove(LLM_KEY_STORAGE.active);
    }
  }
}

export function hasAnyLlmKey(): boolean {
  const { anthropic, openai } = getStoredLlmKeys();
  return Boolean(anthropic || openai);
}

export function buildLlmHeaders(): Record<string, string> {
  const { anthropic, openai } = getStoredLlmKeys();
  const headers: Record<string, string> = {};
  if (anthropic) headers["X-Anthropic-Key"] = anthropic;
  if (openai) headers["X-OpenAI-Key"] = openai;
  return headers;
}

/**
 * Map our internal LlmProvider to the `active_model` value the backend
 * expects in the chat request body. Backend uses "claude" for Anthropic
 * and "chatgpt" for OpenAI.
 */
export function providerToActiveModel(provider: LlmProvider | null): "claude" | "chatgpt" | undefined {
  if (provider === "anthropic") return "claude";
  if (provider === "openai") return "chatgpt";
  return undefined;
}

/**
 * Listen for storage events so other tabs picking up a fresh key are
 * reflected immediately. Returns an unsubscribe function.
 */
export function onLlmKeysChange(handler: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (
      e.key === LLM_KEY_STORAGE.anthropic ||
      e.key === LLM_KEY_STORAGE.openai ||
      e.key === LLM_KEY_STORAGE.active
    ) {
      handler();
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
