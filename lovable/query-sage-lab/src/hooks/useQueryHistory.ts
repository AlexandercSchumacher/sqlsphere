/**
 * Query history hook (LOCAL_MODE).
 *
 * Wraps the FastAPI /api/query-history CRUD. The backend already filters
 * by the demo user, so callers do not pass user_id. Filtering options
 * (favoritesOnly, search, connectionId, etc.) are applied client-side
 * since the simple list endpoint just returns the most recent N entries.
 */

import { useCallback, useState } from "react";
import { api, QueryHistoryEntry as ApiEntry } from "@/lib/api";

export interface QueryHistoryEntry {
  id: string;
  user_id: string;
  connection_id: string | null;
  sql_text: string;
  status: string;
  execution_time_ms: number | null;
  row_count: number | null;
  error_message: string | null;
  is_favorite: boolean;
  title: string | null;
  created_at: string;
}

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

const adapt = (e: ApiEntry): QueryHistoryEntry => ({
  id: e.id,
  user_id: DEMO_USER_ID,
  connection_id: e.connection_id,
  sql_text: e.sql_text,
  status: e.status,
  execution_time_ms: e.execution_time_ms,
  row_count: e.row_count,
  error_message: e.error_message,
  is_favorite: e.is_favorite,
  title: e.title,
  created_at: e.created_at ?? new Date(0).toISOString(),
});

export function useQueryHistory() {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(
    async (opts?: {
      favoritesOnly?: boolean;
      search?: string;
      connectionId?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    }) => {
      setLoading(true);
      try {
        const list = (await api.queryHistory.list(200)).map(adapt);
        let filtered = list;
        if (opts?.favoritesOnly) filtered = filtered.filter((e) => e.is_favorite);
        if (opts?.connectionId) filtered = filtered.filter((e) => e.connection_id === opts.connectionId);
        if (opts?.status) filtered = filtered.filter((e) => e.status === opts.status);
        if (opts?.search) {
          const needle = opts.search.toLowerCase();
          filtered = filtered.filter((e) => e.sql_text.toLowerCase().includes(needle));
        }
        if (opts?.fromDate) filtered = filtered.filter((e) => e.created_at >= opts.fromDate!);
        if (opts?.toDate) filtered = filtered.filter((e) => e.created_at <= opts.toDate!);
        setEntries(filtered);
      } catch {
        /* leave entries unchanged */
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const saveToHistory = useCallback(
    async (entry: {
      connectionId?: string;
      sqlText: string;
      status: "success" | "error";
      executionTimeMs?: number;
      rowCount?: number;
      errorMessage?: string;
    }) => {
      await api.queryHistory.create({
        connection_id: entry.connectionId,
        sql_text: entry.sqlText,
        status: entry.status,
        execution_time_ms: entry.executionTimeMs,
        row_count: entry.rowCount,
        error_message: entry.errorMessage,
      });
    },
    [],
  );

  const toggleFavorite = useCallback(async (id: string, isFavorite: boolean) => {
    await api.queryHistory.update(id, { is_favorite: !isFavorite });
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, is_favorite: !isFavorite } : e)));
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    await api.queryHistory.remove(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { entries, loading, fetchHistory, saveToHistory, toggleFavorite, deleteEntry };
}
