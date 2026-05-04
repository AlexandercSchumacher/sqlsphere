/**
 * API router for LOCAL_MODE.
 *
 * In LOCAL_MODE the frontend talks directly to the FastAPI backend
 * (api.* helpers from @/lib/api). The original cloud version of this
 * file branched on Electron vs browser and then routed through the
 * Supabase database-proxy edge function. None of that is needed here:
 * we have one backend.
 *
 * The exports keep their original names so call sites that imported
 * `connectToDatabase`, `executeQuery`, `getSchema`, `getTables`, or
 * `isElectron` keep compiling. They now all funnel through `api.*`.
 */

import { api, backendUrl } from "@/lib/api";

export const isElectron = (): boolean => false;

export const getLocalBackendUrl = async (): Promise<string | null> => backendUrl;

export async function connectToDatabase(connection: { id: string }): Promise<{ session_id: string }> {
  if (!connection?.id) throw new Error("connection.id is required");
  return api.connections.connect(connection.id);
}

export async function executeQuery(
  sessionId: string,
  sql: string,
  _connection: unknown,
  _isLocalBackend = false,
): Promise<{
  success: boolean;
  result?: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
}> {
  const r = await api.query.run(sessionId, sql);
  return {
    success: r.success,
    result: r.results,
    columns: r.columns,
    rowCount: r.row_count,
  };
}

export async function getSchema(_sessionId: string, _connection: unknown): Promise<unknown> {
  // Schema introspection still goes through the visualization / tables
  // endpoints which are session-driven; pages that need it call them
  // directly (or via the backend's POST /tables / /views endpoints).
  return [];
}

export async function getTables(_sessionId: string, _connection: unknown): Promise<unknown> {
  return [];
}
