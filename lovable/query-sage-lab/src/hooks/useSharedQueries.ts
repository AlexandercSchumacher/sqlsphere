/**
 * LOCAL_MODE shared queries stub.
 *
 * Public share links (sqlsphere.com/share/<token>) are a cloud feature.
 * LOCAL_MODE does not host them; the hook is a no-op that returns empty
 * data and a not-supported error from the share-create call.
 */

export interface SharedQuery {
  id: string;
  token: string;
  title: string;
  sql_text: string;
  result_columns: string[];
  result_data: unknown[];
  row_count: number;
  expires_at: string | null;
  created_at: string;
}

export const useSharedQueries = () => ({
  sharedQueries: [] as SharedQuery[],
  loading: false,
  createSharedQuery: async (): Promise<never> => {
    throw new Error("Sharing queries publicly is not available in LOCAL_MODE.");
  },
  deleteSharedQuery: async () => {},
  refresh: async () => {},
});
