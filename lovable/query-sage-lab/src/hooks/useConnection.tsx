/**
 * LOCAL_MODE connection state.
 *
 * Owns the list of stored connections, the currently selected one, and
 * the live backend session. Talks to the FastAPI backend via the
 * `api` client (no Supabase, no edge functions).
 *
 * The shape mirrors the original cloud-mode hook so existing pages and
 * components keep using `useConnection()` unchanged.
 */

import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { SchemaNode } from "@/components/SchemaTree";
import { api, ApiError, Connection } from "@/lib/api";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  pendingChange?: { oldSQL: string; newSQL: string };
  chartData?: {
    columns: string[];
    results: Record<string, unknown>[];
    chartHint: string | null;
  };
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ConnectionContextType {
  connections: Connection[];
  selectedConnectionId: string | null;
  sessionId: string | null;
  connectionStatus: ConnectionStatus;
  chatMessages: ChatMessage[];
  schemaTree: SchemaNode[];
  selectConnection: (connectionId: string) => Promise<void>;
  setChatMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setSchemaTree: (tree: SchemaNode[]) => void;
  reloadConnections: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

const STORAGE_KEY_CONNECTION = "sqlsphere_selected_connection";
const STORAGE_KEY_SESSION = "sqlsphere_session_id";
const MESSAGES_KEY_PREFIX = "sqlsphere_chat_messages_";
const MAX_STORED_MESSAGES = 200;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export const ConnectionProvider = ({ children }: { children: ReactNode }) => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY_CONNECTION),
  );
  const [sessionId, setSessionId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY_SESSION),
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [chatMessages, setChatMessagesState] = useState<ChatMessage[]>([]);
  const [schemaTree, setSchemaTree] = useState<SchemaNode[]>([]);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInitializedRef = useRef(false);

  const loadStoredMessages = useCallback((connectionId: string): ChatMessage[] => {
    try {
      const stored = sessionStorage.getItem(MESSAGES_KEY_PREFIX + connectionId);
      if (stored) {
        const parsed = JSON.parse(stored) as Array<ChatMessage & { timestamp: string }>;
        return parsed.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
    } catch {
      /* ignore */
    }
    return [];
  }, []);

  const persistMessages = useCallback((connectionId: string, messages: ChatMessage[]) => {
    try {
      const toStore = messages.slice(-MAX_STORED_MESSAGES);
      sessionStorage.setItem(MESSAGES_KEY_PREFIX + connectionId, JSON.stringify(toStore));
    } catch {
      /* sessionStorage full -> ignore */
    }
  }, []);

  const setChatMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setChatMessagesState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (selectedConnectionId) persistMessages(selectedConnectionId, next);
        return next;
      });
    },
    [selectedConnectionId, persistMessages],
  );

  const loadConnections = useCallback(async (): Promise<Connection[]> => {
    try {
      const list = await api.connections.list();
      setConnections(list);
      return list;
    } catch (err) {
      console.error("Error loading connections:", err);
      return [];
    }
  }, []);

  const validateSession = useCallback(async (sid: string): Promise<boolean> => {
    try {
      await api.session.get(sid);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return false;
      return false;
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      await api.session.refresh(sessionId);
    } catch {
      setConnectionStatus("disconnected");
      setSessionId(null);
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  }, [sessionId]);

  const connectToDb = useCallback(async (connectionId: string) => {
    setConnectionStatus("connecting");
    try {
      const result = await api.connections.connect(connectionId);
      if (result.session_id) {
        setSessionId(result.session_id);
        localStorage.setItem(STORAGE_KEY_SESSION, result.session_id);
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("error");
      }
    } catch (err) {
      console.error("Error opening session:", err);
      setConnectionStatus("error");
      setSessionId(null);
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  }, []);

  const selectConnection = useCallback(
    async (connectionId: string) => {
      const isSame = connectionId === selectedConnectionId;
      if (isSame && sessionId && connectionStatus === "connected") return;

      setSelectedConnectionId(connectionId);
      localStorage.setItem(STORAGE_KEY_CONNECTION, connectionId);

      if (!isSame) {
        const stored = loadStoredMessages(connectionId);
        setChatMessagesState(stored);
        setSchemaTree([]);
      }

      await connectToDb(connectionId);
    },
    [selectedConnectionId, sessionId, connectionStatus, connectToDb, loadStoredMessages],
  );

  const reloadConnections = useCallback(async () => {
    await loadConnections();
  }, [loadConnections]);

  // Initialise on mount.
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    void (async () => {
      const loaded = await loadConnections();
      if (!loaded.length) return;

      const storedConnectionId = localStorage.getItem(STORAGE_KEY_CONNECTION);
      const storedSessionId = localStorage.getItem(STORAGE_KEY_SESSION);

      let target = storedConnectionId;
      if (!target || !loaded.find((c) => c.id === target)) {
        const def = loaded.find((c) => c.is_default);
        target = (def || loaded[0]).id;
      }
      setSelectedConnectionId(target);
      localStorage.setItem(STORAGE_KEY_CONNECTION, target);

      const stored = loadStoredMessages(target);
      setChatMessagesState(stored);

      if (storedSessionId && (await validateSession(storedSessionId))) {
        setSessionId(storedSessionId);
        setConnectionStatus("connected");
        return;
      }
      await connectToDb(target);
    })();
  }, [loadConnections, validateSession, connectToDb, loadStoredMessages]);

  // Session keep-alive.
  useEffect(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    if (sessionId && connectionStatus === "connected") {
      refreshIntervalRef.current = setInterval(refreshSession, REFRESH_INTERVAL_MS);
    }
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [sessionId, connectionStatus, refreshSession]);

  // Refresh on tab visibility (handles browser sleep).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && sessionId && connectionStatus === "connected") {
        refreshSession();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sessionId, connectionStatus, refreshSession]);

  return (
    <ConnectionContext.Provider
      value={{
        connections,
        selectedConnectionId,
        sessionId,
        connectionStatus,
        chatMessages,
        schemaTree,
        selectConnection,
        setChatMessages,
        setSchemaTree,
        reloadConnections,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => {
  const context = useContext(ConnectionContext);
  if (!context) throw new Error("useConnection must be used within a ConnectionProvider");
  return context;
};
