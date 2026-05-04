import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useConnection, ChatMessage } from '@/hooks/useConnection';
import { connectToDatabase, getSchema, isElectron } from '@/utils/apiRouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useQueryHistory } from '@/hooks/useQueryHistory';
import { SQLEditor } from '@/components/SQLEditor';
import Layout from '@/components/Layout';
import { AuthDialog } from '@/components/AuthDialog';
import { ConfirmActionModal } from '@/components/ConfirmActionModal';
import { ConnectionDropdown } from '@/components/ConnectionDropdown';
import { SchemaTree, SchemaNode } from '@/components/SchemaTree';
import { getSmartContext, formatContextForLLM } from '@/utils/contextSelection';
import { ChatChart } from '@/components/ChatChart';
import DiffMatchPatch from 'diff-match-patch';

// Create a single instance of DiffMatchPatch to reuse (performance optimization)
const dmpInstance = new DiffMatchPatch();
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table as TableIcon,
  Eye,
  PlayCircle,
  Trash2,
  Send,
  Plus,
  RefreshCw,
  PanelRightClose,
  PanelRightOpen,
  X,
  Code,
  FileText,
  Zap,
  List,
  Layers,
  Check,
  Square,
} from 'lucide-react';

// ChatMessage type is imported from useConnection

interface SQLQuery {
  id: string;
  sql: string;
  timestamp: Date;
  status: 'pending' | 'executing' | 'success' | 'error';
  results?: any[];
  columns?: string[];
  error?: string;
  rowCount?: number;
  executionTime?: number;
}


export default function ChatCursor() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { saveToHistory } = useQueryHistory();
  const {
    connections,
    selectedConnectionId,
    sessionId,
    connectionStatus,
    chatMessages: messages,
    schemaTree,
    selectConnection,
    setChatMessages: setMessages,
    setSchemaTree,
    reloadConnections,
  } = useConnection();

  // Alias for backward compat within this component
  const selectedConnection = selectedConnectionId || '';

  // State
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState<'claude' | 'chatgpt'>('chatgpt');
  
  // SQL Editor State - Multiple Query Files/Tabs
  const [queryFiles, setQueryFiles] = useState<Array<{
    id: string;
    name: string;
    content: string;
  }>>([{
    id: '1',
    name: 'Query 1',
    content: '-- Write your SQL query here\nSELECT * FROM users LIMIT 10;'
  }]);
  const [activeFileId, setActiveFileId] = useState('1');
  const [queries, setQueries] = useState<SQLQuery[]>([]);
  const [rowsToShowByQuery, setRowsToShowByQuery] = useState<Record<string, number>>({});
  const [pendingChange, setPendingChange] = useState<{ oldSQL: string; newSQL: string; messageId: string } | null>(null);
  const [dmlConfirmOpen, setDmlConfirmOpen] = useState(false);
  const [dmlPending, setDmlPending] = useState<{
    sql: string;
    previewSql: string | null;
    explanation: string;
    previewData: { columns: string[]; rows: any[]; row_count?: number } | null;
    isCreate: boolean;
  } | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Schema Browser State (schemaTree and setSchemaTree come from useConnection context)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaBrowserCollapsed, setSchemaBrowserCollapsed] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: SchemaNode;
  } | null>(null);
  
  // Panel State
  const [queryPanelHeight, setQueryPanelHeight] = useState(200);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryResultsRef = useRef<HTMLDivElement>(null);
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive (optimized - only scroll on new messages)
  const prevMessagesLength = useRef(messages.length);
  useEffect(() => {
    // Only scroll if a new message was added (not on every render)
    if (messages.length > prevMessagesLength.current || loading) {
      const timer = setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }, 100);
      prevMessagesLength.current = messages.length;
      return () => clearTimeout(timer);
    }
  }, [messages.length, loading]);

  // Load schema when connection is selected and session is available
  useEffect(() => {
    if (selectedConnection && sessionId) {
      loadSchema();
    }
  }, [selectedConnection, sessionId]);

  // Handle connection selection from dropdown
  const handleConnectionSelect = async (connectionId: string) => {
    if (!user) {
      setAuthDialogOpen(true);
      return;
    }
    await selectConnection(connectionId);
  };

  const loadSchema = async (retryCount = 0) => {
    if (!selectedConnection || !sessionId) return;

    setSchemaLoading(true);
    try {
      const connection = connections.find(c => c.id === selectedConnection);
      if (!connection) return;

      let data;
      const isLocalAgent = (connection.connection_method === 'local' || connection.connectionMethod === 'local') && isElectron();

      if (isLocalAgent) {
        try {
          data = await getSchema(sessionId, connection);
        } catch (err) {
          // Retry once after 2s for local agent (agent may still be processing)
          if (retryCount === 0) {
            await new Promise((r) => setTimeout(r, 2000));
            return loadSchema(1);
          }
          throw err;
        }
      } else {
        // Use cloud backend for cloud connections or web app
        const result = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/tables',
            connectionId: selectedConnection,
          },
        });
        if (result.error) throw result.error;
        data = result.data;
      }

      // Build schema tree grouped by schema: Schema -> Tables/Views/... -> Table/View -> Columns
      const schemaMap: Record<string, {
        tables: any[];
        views: any[];
        materialized_views: any[];
        procedures: any[];
        functions: any[];
        triggers: any[];
        sequences: any[];
      }> = {};

      const addToSchema = (collection: any[] | undefined, key: keyof typeof schemaMap[string]) => {
        (collection || []).forEach((item: any) => {
          const schemaName = item.schema || 'public';
          if (!schemaMap[schemaName]) {
            schemaMap[schemaName] = {
              tables: [],
              views: [],
              materialized_views: [],
              procedures: [],
              functions: [],
              triggers: [],
              sequences: [],
            };
          }
          schemaMap[schemaName][key].push(item);
        });
      };

      addToSchema(data.tables, 'tables');
      addToSchema(data.views, 'views');
      addToSchema(data.materialized_views, 'materialized_views');
      addToSchema(data.procedures, 'procedures');
      addToSchema(data.functions, 'functions');
      addToSchema(data.triggers, 'triggers');
      addToSchema(data.sequences, 'sequences');

      const schemaNames = Object.keys(schemaMap).sort();

      const tree: SchemaNode[] = schemaNames.map((schemaName) => {
        const groups: SchemaNode[] = [];
        const schemaEntry = schemaMap[schemaName];

        if (schemaEntry.tables.length > 0) {
          groups.push({
            name: 'Tables',
            type: 'group',
            count: schemaEntry.tables.length,
            children: schemaEntry.tables.map((t: any) => ({
              name: t.name,
              type: 'table' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.views.length > 0) {
          groups.push({
            name: 'Views',
            type: 'group',
            count: schemaEntry.views.length,
            children: schemaEntry.views.map((v: any) => ({
              name: v.name,
              type: 'view' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.materialized_views.length > 0) {
          groups.push({
            name: 'Materialized Views',
            type: 'group',
            count: schemaEntry.materialized_views.length,
            children: schemaEntry.materialized_views.map((mv: any) => ({
              name: mv.name,
              type: 'materialized_view' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.procedures.length > 0) {
          groups.push({
            name: 'Procedures',
            type: 'group',
            count: schemaEntry.procedures.length,
            children: schemaEntry.procedures.map((p: any) => ({
              name: p.name,
              type: 'procedure' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.functions.length > 0) {
          groups.push({
            name: 'Functions',
            type: 'group',
            count: schemaEntry.functions.length,
            children: schemaEntry.functions.map((f: any) => ({
              name: f.name,
              type: 'function' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.triggers.length > 0) {
          groups.push({
            name: 'Triggers',
            type: 'group',
            count: schemaEntry.triggers.length,
            children: schemaEntry.triggers.map((t: any) => ({
              name: t.name,
              type: 'trigger' as const,
              schema: schemaName,
            })),
          });
        }

        if (schemaEntry.sequences.length > 0) {
          groups.push({
            name: 'Sequences',
            type: 'group',
            count: schemaEntry.sequences.length,
            children: schemaEntry.sequences.map((s: any) => ({
              name: s.name,
              type: 'sequence' as const,
              schema: schemaName,
            })),
          });
        }

        return {
          name: schemaName,
          type: 'schema',
          children: groups,
        } as SchemaNode;
      });

      setSchemaTree(tree);
    } catch (error) {
      console.error('Error loading schema:', error);
    } finally {
      setSchemaLoading(false);
    }
  };

  // Helper function to get current file - defined here to be available before usage
  const getCurrentFile = useCallback(() => {
    return queryFiles.find(f => f.id === activeFileId) || queryFiles[0];
  }, [queryFiles, activeFileId]);

  // Memoize code context calculation for performance
  const currentFile = getCurrentFile();
  const currentCode = currentFile.content;
  const codeContext = useMemo(() => 
    getSmartContext(currentCode, inputValue, cursorPosition?.line),
    [currentCode, inputValue, cursorPosition?.line]
  );
  const editorContext = useMemo(() => 
    codeContext.totalLines > 50 
      ? formatContextForLLM(codeContext, true)
      : currentCode,
    [codeContext, currentCode]
  );

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
      toast({
        title: t('chat.generationStopped'),
        description: t('chat.generationStoppedDesc'),
      });
    }
  }, [toast, t]);

  const handleSendMessage = useCallback(async () => {
    if (!user) {
      setAuthDialogOpen(true);
      return;
    }
    if (!inputValue.trim() || !sessionId) return;

    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sessionId,
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/chat',
          connectionId: selectedConnection,
          session_id: sessionId,
          query: inputValue,
          conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
          activeModel: activeModel,
          language: i18n.language.split('-')[0],
          // Send current editor code with intelligent context selection
          current_editor_code: editorContext,
          code_context_metadata: codeContext.totalLines > codeContext.contextLines ? {
            total_lines: codeContext.totalLines,
            context_lines: codeContext.contextLines,
            cursor_line: cursorPosition?.line,
          } : undefined,
        },
        signal: abortController.signal,
      });

      // Check if request was aborted
      if (abortController.signal.aborted) {
        return;
      }

      if (error) {
        // Don't show error if request was aborted
        if (abortController.signal.aborted || error?.name === 'AbortError') {
          return;
        }
        throw error;
      }

      // Handle AI response
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sessionId,
        role: 'assistant',
        content: data.explanation || 'Query executed successfully.',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, aiMessage]);

      console.log('AI Response:', { 
        mode: data.mode, 
        hasSQL: !!data.sql, 
        sql: data.sql?.substring(0, 100),
        hasResults: !!data.results,
        resultsCount: data.results?.length
      });

      // If there's SQL, handle it automatically (both 'db' and 'select' modes)
      // Also handle SQL even if mode is 'chat' (fallback for cases where AI incorrectly used chat mode)
      if (data.sql && (data.mode === 'db' || data.mode === 'select' || (data.mode === 'chat' && data.sql.trim()))) {
        if (data.requires_confirmation) {
          const sqlUpper = (data.sql as string).toUpperCase().trim();
          const isCreate = sqlUpper.startsWith('CREATE') || sqlUpper.startsWith('ALTER');

          let previewData: { columns: string[]; rows: any[]; row_count?: number } | null = null;
          if (data.preview_sql) {
            previewData = await executePreviewSQL(data.preview_sql);
          }

          setDmlPending({
            sql: data.sql,
            previewSql: data.preview_sql ?? null,
            explanation: data.explanation ?? '',
            previewData,
            isCreate,
          });
          setDmlConfirmOpen(true);
          return; // finally block still runs → clears loading state correctly
        }

        console.log('AI returned SQL:', data.sql.substring(0, 100));
        
        // Check if this is modifying an existing object (VIEW, PROCEDURE, FUNCTION, etc.)
        const sqlUpper = data.sql.toUpperCase();
        
        // Extract object name if it's a CREATE/ALTER statement
        let objectName: string | null = null;
        let objectType: string | null = null;
        if (sqlUpper.includes('CREATE') || sqlUpper.includes('ALTER') || sqlUpper.includes('REPLACE')) {
          const viewMatch = data.sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?([\w]+)/i);
          const procMatch = data.sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|PROC)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?([\w]+)/i);
          const funcMatch = data.sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?([\w]+)/i);
          const tableMatch = data.sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?([\w]+)/i);
          
          if (viewMatch) {
            objectName = viewMatch[1];
            objectType = 'view';
          } else if (procMatch) {
            objectName = procMatch[1];
            objectType = 'procedure';
          } else if (funcMatch) {
            objectName = funcMatch[1];
            objectType = 'function';
          } else if (tableMatch) {
            objectName = tableMatch[1];
            objectType = 'table';
          }
        }
        
        console.log('Detected object:', { objectName, objectType });
        
        // Find existing file for this object, or create new one
        let targetFileId = activeFileId;
        let isNewFile = false;
        
        if (objectName && objectType) {
          // Try to find existing file with this object
          const existingFile = queryFiles.find(f => {
            const fileName = f.name.toLowerCase();
            const fileContent = f.content.toUpperCase();
            return fileName.includes(objectName!.toLowerCase()) ||
                   fileContent.includes(`CREATE ${objectType.toUpperCase()}`) ||
                   fileContent.includes(`ALTER ${objectType.toUpperCase()}`) ||
                   fileContent.includes(`REPLACE ${objectType.toUpperCase()}`) ||
                   (fileContent.includes(objectName.toUpperCase()) && 
                    (fileContent.includes('CREATE') || fileContent.includes('ALTER')));
          });
          
          if (existingFile) {
            console.log('Found existing file for object:', existingFile.name);
            // Use existing file
            targetFileId = existingFile.id;
            setActiveFileId(targetFileId);
            
            // Show diff in editor (modification)
            const oldSQL = existingFile.content;
            aiMessage.pendingChange = {
              oldSQL,
              newSQL: data.sql,
            };
            setPendingChange({
              oldSQL,
              newSQL: data.sql,
              messageId: aiMessage.id,
            });
            
            // Update message with pending change
            setMessages(prev => prev.map(msg => 
              msg.id === aiMessage.id ? aiMessage : msg
            ));
            
            // Execute SQL automatically after showing diff
            setTimeout(() => {
              executeSQL(data.sql);
            }, 100);
          } else {
            console.log('Creating new file for object:', objectName);
            // Create new file for this object
            const newId = Date.now().toString();
            const newFile = {
              id: newId,
              name: `${objectName} (${objectType})`,
              content: data.sql,
            };
            console.log('New file created:', newFile);
            setQueryFiles(prev => {
              const updated = [...prev, newFile];
              console.log('Updated queryFiles:', updated.length, 'files');
              return updated;
            });
            setActiveFileId(newId);
            targetFileId = newId;
            isNewFile = true;
            
            // Execute SQL automatically after a short delay to ensure state is updated
            setTimeout(() => {
              console.log('Executing SQL for new file');
              executeSQL(data.sql);
            }, 200);
          }
        } else {
          // For SELECT queries or other queries - always create new file
          console.log('Creating new file for query');
          const newId = Date.now().toString();
          const newFile = {
            id: newId,
            name: `Query ${queryFiles.length + 1}`,
            content: data.sql,
          };
          console.log('New query file created:', newFile);
          setQueryFiles(prev => {
            const updated = [...prev, newFile];
            console.log('Updated queryFiles:', updated.length, 'files');
            return updated;
          });
          setActiveFileId(newId);
          targetFileId = newId;
          isNewFile = true;
          
          // Execute SQL automatically after a short delay to ensure state is updated
          setTimeout(() => {
            console.log('Executing SQL for new query file');
            executeSQL(data.sql);
          }, 200);
        }
        
        // Update message with SQL info
        setMessages(prev => prev.map(msg =>
          msg.id === aiMessage.id ? aiMessage : msg
        ));

        // For mode='select' the backend already executed the query — attach chart data inline
        if (data.mode === 'select' && data.results?.length >= 2 && data.columns?.length >= 2) {
          aiMessage.chartData = {
            columns: data.columns,
            results: data.results,
            chartHint: data.chart_hint ?? null,
          };
          setMessages(prev => prev.map(msg => msg.id === aiMessage.id ? aiMessage : msg));
        }
      } else if (data.mode === 'select' && data.results) {
        // If mode is 'select' and we have results, display them in query results panel
        // The SQL was already executed by the backend, so we just need to show the results
        console.log('Displaying results from backend:', data.results.length, 'rows');

        // Attach chart data to the AI message so it renders inline
        if (data.results.length >= 2 && data.columns?.length >= 2) {
          aiMessage.chartData = {
            columns: data.columns,
            results: data.results,
            chartHint: data.chart_hint ?? null,
          };
          setMessages(prev => prev.map(msg => msg.id === aiMessage.id ? aiMessage : msg));
        }

        // Create a query object to display in the results panel
        const queryId = Date.now().toString();
        const query: SQLQuery = {
          id: queryId,
          sql: data.sql || '',
          timestamp: new Date(),
          status: 'success',
          results: data.results,
          columns: data.columns || [],
          rowCount: data.row_count || 0,
          executionTime: data.execution_time_ms || 0,
        };

        setQueries(prev => [query, ...prev]);
        setRowsToShowByQuery(prev => ({ ...prev, [queryId]: 10 }));

        // Save to query history
        saveToHistory({
          connectionId: selectedConnection || undefined,
          sqlText: data.sql || '',
          status: 'success',
          executionTimeMs: data.execution_time_ms || 0,
          rowCount: data.row_count || 0,
        });

        // Also create a new file with the SQL if we have it
        if (data.sql) {
          const newId = Date.now().toString();
          const newFile = {
            id: newId,
            name: `Query ${queryFiles.length + 1}`,
            content: data.sql,
          };
          setQueryFiles(prev => [...prev, newFile]);
          setActiveFileId(newId);
        }
      }

    } catch (error: any) {
      // Don't show error if request was aborted
      if (abortController.signal.aborted || error?.name === 'AbortError') {
        return;
      }
      
      console.error('Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to get AI response',
        variant: 'destructive',
      });
    } finally {
      // Only clear loading if not aborted
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
      abortControllerRef.current = null;
    }
  }, [user, inputValue, sessionId, selectedConnection, messages, i18n.language, editorContext, codeContext, queryFiles, activeFileId, cursorPosition]);

  const executeSQL = async (sql: string) => {
    const queryId = Date.now().toString();
    const query: SQLQuery = {
      id: queryId,
      sql,
      timestamp: new Date(),
      status: 'executing',
    };

    setQueries(prev => [query, ...prev]);
    setRowsToShowByQuery(prev => ({ ...prev, [queryId]: 10 }));

    try {
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/query',
          connectionId: selectedConnection,
          session_id: sessionId,
          query: sql,
        },
      });

      console.log('Query response:', { data, error });

      // Extract detailed error message from response data first (even on error, data might contain details)
      const extractSqlError = (responseData: any): string => {
        if (!responseData) return '';
        
        // Check various locations where the error might be
        if (responseData.detail) {
          // Parse SQL error from detail string
          const detail = responseData.detail;
          if (typeof detail === 'string' && detail.includes('ERROR:')) {
            // Extract just the ERROR part
            const match = detail.match(/ERROR:\s*([^;\\]+)/);
            if (match) return match[1].trim();
            return detail;
          }
          return detail;
        }
        if (responseData.error) return responseData.error;
        if (responseData.details?.detail) return responseData.details.detail;
        if (responseData.message) return responseData.message;
        return '';
      };

      // Check if we have error data in the response (even if error is set)
      if (error || (data && !data.success)) {
        let detailedError = extractSqlError(data) || 'Query execution failed';
        
        // If still generic, try to parse from error object
        if (detailedError === 'Query execution failed' && error) {
          if (error.message && !error.message.includes('non-2xx')) {
            detailedError = error.message;
          }
        }
        
        // Clean up common prefixes
        if (detailedError.includes('Error executing query:')) {
          detailedError = detailedError.replace('Error executing query:', '').trim();
        }
        
        throw new Error(detailedError);
      }


      // Extract columns and results
      const columns = data.columns || (data.results && data.results.length > 0 ? Object.keys(data.results[0]) : []);
      const results = data.results || [];

      // Update query with results, columns and full row count
      setQueries(prev =>
        prev.map(q =>
          q.id === query.id
            ? {
                ...q,
                status: 'success',
                results: results,
                columns: columns,
                rowCount: data.row_count || results.length,
                executionTime: data.execution_time_ms || 0,
              }
            : q
        )
      );

      toast({
        title: 'Query executed',
        description: `${data.row_count || results.length} row(s) returned.`,
      });

      // Save to query history
      saveToHistory({
        connectionId: selectedConnection || undefined,
        sqlText: sql,
        status: 'success',
        executionTimeMs: data.execution_time_ms || 0,
        rowCount: data.row_count || results.length,
      });

    } catch (error: any) {
      console.error('Full error object:', error);
      
      // Extract the most detailed error message available
      let errorMessage = 'Query failed';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Try to extract SQL error from nested error structure
      if (error.context?.message) {
        errorMessage = error.context.message;
      }
      
      setQueries(prev =>
        prev.map(q =>
          q.id === query.id
            ? {
                ...q,
                status: 'error',
                error: errorMessage,
              }
            : q
        )
      );

      toast({
        title: 'SQL Error',
        description: errorMessage.substring(0, 100) + (errorMessage.length > 100 ? '...' : ''),
        variant: 'destructive',
      });

      // Save error to query history
      saveToHistory({
        connectionId: selectedConnection || undefined,
        sqlText: sql,
        status: 'error',
        errorMessage: errorMessage.substring(0, 500),
      });

      // Ask AI to analyze the error and suggest a fix
      // This adds the error analysis to the chat so the user can see it
      if (selectedConnection && !loading) {
        (async () => {
          try {
            setLoading(true);
            
            // Add user message about the error
            const errorUserMessage: ChatMessage = {
              id: Date.now().toString(),
              sessionId: sessionId || '',
              role: 'user',
              content: `I tried to execute this SQL query but got an error. Please analyze the error, explain what went wrong, and provide the corrected SQL code.\n\nMy SQL:\n\`\`\`sql\n${sql}\n\`\`\`\n\nError message:\n${errorMessage}`,
              timestamp: new Date(),
            };
            
            setMessages(prev => [...prev, errorUserMessage]);

            const { data: aiData, error: aiError } = await supabase.functions.invoke('database-proxy', {
              body: {
                endpoint: '/chat',
                connectionId: selectedConnection,
                session_id: sessionId || undefined,
                query: errorUserMessage.content,
                conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
                activeModel: activeModel,
                language: i18n.language.split('-')[0],
              },
            });

            if (aiError) throw aiError;

            console.log('AI response for error:', aiData);

            // Add AI response
            const aiMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              sessionId: sessionId || '',
              role: 'assistant',
              content: aiData.explanation || 'Here is the corrected SQL.',
              timestamp: new Date(),
            };

            setMessages(prev => [...prev, aiMessage]);

            // If AI provided corrected SQL, show diff in editor and attach to message
            if (aiData.sql && aiData.sql.trim() !== '') {
              console.log('Setting pending change with SQL:', aiData.sql);
              const pendingChange = {
                messageId: aiMessage.id,
                oldSQL: sql,
                newSQL: aiData.sql,
                explanation: aiData.explanation || '',
              };
              setPendingChange(pendingChange);
              aiMessage.pendingChange = pendingChange;
              setMessages(prev => prev.map(msg => 
                msg.id === aiMessage.id ? aiMessage : msg
              ));
              
              // Update editor content with corrected SQL
              updateFileContent(activeFileId, aiData.sql);
              
              // Execute corrected SQL — if DML/DDL, route through confirmation modal
              if (aiData.requires_confirmation) {
                const sqlUpper = (aiData.sql as string).toUpperCase().trim();
                const isCreate = sqlUpper.startsWith('CREATE') || sqlUpper.startsWith('ALTER');
                setDmlPending({
                  sql: aiData.sql,
                  previewSql: aiData.preview_sql ?? null,
                  explanation: aiData.explanation ?? '',
                  previewData: null,
                  isCreate,
                });
                setDmlConfirmOpen(true);
              } else {
                setTimeout(() => {
                  console.log('Executing corrected SQL after error fix');
                  executeSQL(aiData.sql);
                }, 200);
              }
            } else {
              console.warn('AI did not provide SQL code. Response:', aiData);
            }
          } catch (aiError) {
            console.error('Error getting AI analysis:', aiError);
          } finally {
            setLoading(false);
          }
        })();
      }
    }
  };

  const executePreviewSQL = async (
    previewSql: string
  ): Promise<{ columns: string[]; rows: any[]; row_count?: number } | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/query',
          connectionId: selectedConnection,
          session_id: sessionId,
          query: previewSql,
        },
      });
      if (error || !data?.columns) return null;
      return { columns: data.columns, rows: data.results || [], row_count: data.row_count };
    } catch {
      return null;
    }
  };

  // Query File Management
  const addNewQueryFile = () => {
    const newId = Date.now().toString();
    const newFile = {
      id: newId,
      name: `Query ${queryFiles.length + 1}`,
      content: '-- New query\n',
    };
    setQueryFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
  };

  const closeQueryFile = (fileId: string) => {
    if (queryFiles.length === 1) return; // Keep at least one file
    
    const fileIndex = queryFiles.findIndex(f => f.id === fileId);
    const newFiles = queryFiles.filter(f => f.id !== fileId);
    setQueryFiles(newFiles);
    
    // Switch to adjacent tab if closing active tab
    if (fileId === activeFileId) {
      const newActiveIndex = Math.min(fileIndex, newFiles.length - 1);
      setActiveFileId(newFiles[newActiveIndex].id);
    }
  };

  const updateFileContent = (fileId: string, content: string) => {
    setQueryFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, content } : f
    ));
  };

  const renameFile = (fileId: string, newName: string) => {
    setQueryFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, name: newName } : f
    ));
  };


  const handleAcceptChange = (messageId: string, newSQL: string) => {
    updateFileContent(activeFileId, newSQL);
    executeSQL(newSQL);
    // Remove pending change from message and editor
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, pendingChange: undefined }
        : msg
    ));
    setPendingChange(null);
  };

  const handleRejectChange = (messageId: string) => {
    // Remove pending change from message and editor
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, pendingChange: undefined }
        : msg
    ));
    setPendingChange(null);
  };

  const handleDmlConfirm = () => {
    if (dmlPending) {
      const newId = Date.now().toString();
      setQueryFiles(prev => [...prev, {
        id: newId,
        name: `Query ${queryFiles.length + 1}`,
        content: dmlPending.sql,
      }]);
      setActiveFileId(newId);
      executeSQL(dmlPending.sql);
    }
    setDmlConfirmOpen(false);
    setDmlPending(null);
  };

  const handleDmlCancel = () => {
    if (dmlPending) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sessionId,
        role: 'assistant' as const,
        content: t('chat.modificationCancelled'),
        timestamp: new Date(),
      }]);
    }
    setDmlConfirmOpen(false);
    setDmlPending(null);
  };

  // Context menu actions
  const handleNodeAction = async (node: SchemaNode, action: string) => {
    setContextMenu(null);

    // Determine DB type for syntax differences
    const connType = connections.find(c => c.id === selectedConnection)?.type || 'PostgreSQL';
    const isSqlServer = connType === 'SQL Server';
    const isMysql = connType === 'MySQL';

    // Quote identifiers based on DB type
    const quoteId = (name: string) => {
      if (isSqlServer) return `[${name}]`;
      if (isMysql) return `\`${name}\``;
      return `"${name}"`;
    };

    const tableName = node.schema
      ? `${quoteId(node.schema)}.${quoteId(node.name)}`
      : quoteId(node.name);

    switch (action) {
      case 'select_all':
        // Create new query file with SELECT * FROM
        // IMPORTANT: Always add LIMIT 100 when executing to prevent memory issues with large tables
        {
          const selectQuery = isSqlServer
            ? `SELECT TOP 100 * FROM ${tableName};`
            : `SELECT * FROM ${tableName} LIMIT 100;`;
          const newId = Date.now().toString();
          const newFile = {
            id: newId,
            name: node.name,
            content: `-- Query ${node.name}\n${selectQuery}`,
          };
          setQueryFiles(prev => [...prev, newFile]);
          setActiveFileId(newId);
          // Execute with LIMIT/TOP 100 to prevent memory issues (user can modify query if needed)
          executeSQL(selectQuery);
        }
        break;
        
      case 'view_definition':
      case 'procedure_definition':
      case 'function_definition':
      case 'trigger_definition':
        // Get object definition
        try {
          const { data, error } = await supabase.functions.invoke('database-proxy', {
            body: {
              endpoint: '/object-definition',
              connectionId: selectedConnection,
              objectName: node.name,
              objectType: node.type,
              schema: node.schema,
            },
          });
          
          if (error) throw error;
          
          const definition = data.definition || data.definition_sql || 'No definition found';
          const newId = Date.now().toString();
          const newFile = {
            id: newId,
            name: `${node.name} (Definition)`,
            content: `-- ${node.type.toUpperCase()} Definition: ${node.name}\n${definition}`,
          };
          setQueryFiles(prev => [...prev, newFile]);
          setActiveFileId(newId);
        } catch (error) {
          console.error('Error fetching definition:', error);
          toast({
            title: 'Error',
            description: 'Failed to fetch object definition',
            variant: 'destructive',
          });
        }
        break;
        
      case 'call_procedure':
        // Execute procedure — syntax differs per DB
        if (isSqlServer) {
          executeSQL(`EXEC ${tableName};`);
        } else {
          executeSQL(`CALL ${tableName}();`);
        }
        break;
        
      case 'show_structure':
        // Show table structure (columns, types, etc.)
        try {
          const escapedName = node.name.replace(/'/g, "''");
          const escapedSchema = node.schema ? node.schema.replace(/'/g, "''") : '';
          const structureQuery = isSqlServer
            ? `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${escapedName}' ${escapedSchema ? `AND TABLE_SCHEMA = '${escapedSchema}'` : ''} ORDER BY ORDINAL_POSITION;`
            : `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${escapedName}' ${escapedSchema ? `AND table_schema = '${escapedSchema}'` : ''} ORDER BY ordinal_position;`;
          const { data, error } = await supabase.functions.invoke('database-proxy', {
            body: {
              endpoint: '/query',
              connectionId: selectedConnection,
              session_id: sessionId,
              query: structureQuery,
            },
          });

          if (error) throw error;

          if (data.success && data.results) {
            const structureText = data.results.map((r: any) => {
              const colName = r.column_name || r.COLUMN_NAME;
              const dataType = r.data_type || r.DATA_TYPE;
              const nullable = r.is_nullable || r.IS_NULLABLE;
              const colDefault = r.column_default || r.COLUMN_DEFAULT;
              return `${colName} (${dataType})${nullable === 'YES' ? ' NULL' : ' NOT NULL'}${colDefault ? ` DEFAULT ${colDefault}` : ''}`;
            }).join('\n');

            const newId = Date.now().toString();
            const newFile = {
              id: newId,
              name: `${node.name} (Structure)`,
              content: `-- Structure of ${node.name}\n${structureText}`,
            };
            setQueryFiles(prev => [...prev, newFile]);
            setActiveFileId(newId);
          }
        } catch (error) {
          console.error('Error fetching structure:', error);
        }
        break;
    }
  };

  const toggleNode = useCallback((path: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);


  const loadColumnsForNode = useCallback(async (node: SchemaNode, nodePath: string) => {
    if (!selectedConnection || node.columnsLoaded) return;
    
    // Only load columns for tables, views, and materialized views
    if (node.type !== 'table' && node.type !== 'view' && node.type !== 'materialized_view') {
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: `/columns/${node.name}`,
          connectionId: selectedConnection,
        },
      });

      if (error) {
        console.error('Error loading columns:', error);
        return;
      }

      // Convert columns to SchemaNode format
      const columnNodes: SchemaNode[] = (data.columns || []).map((col: any) => ({
        name: col.column || col.name || col.COLUMN_NAME || col.column_name,
        type: 'column' as const,
        dataType: col.data_type || col.type || col.DATA_TYPE || col.data_type,
        nullable: col.nullable !== false && col.nullable !== 'NO',
        schema: node.schema || col.schema || col.TABLE_SCHEMA || col.table_schema,
      }));

      // Update the schema tree to include columns
      const updateNodeWithColumns = (nodes: SchemaNode[], currentPath: string = ''): SchemaNode[] => {
        return nodes.map(n => {
          const nPath = currentPath ? `${currentPath}.${n.name}` : n.name;
          if (nPath === nodePath) {
            return {
              ...n,
              children: columnNodes,
              columnsLoaded: true,
            };
          }
          if (n.children) {
            return {
              ...n,
              children: updateNodeWithColumns(n.children, nPath),
            };
          }
          return n;
        });
      };

      setSchemaTree(updateNodeWithColumns(schemaTree));
      // Auto-expand after loading columns
      setExpandedNodes(prev => new Set([...prev, nodePath]));
    } catch (error) {
      console.error('Error loading columns:', error);
    }
  }, [selectedConnection, schemaTree, setSchemaTree]);

  const getContextMenuActions = (node: SchemaNode): Array<{ label: string; action: string; icon?: React.ReactNode }> => {
    const actions: Array<{ label: string; action: string; icon?: React.ReactNode }> = [];
    
    switch (node.type) {
      case 'table':
        actions.push(
          { label: 'Select Top 100 Rows', action: 'select_all', icon: <TableIcon className="h-3 w-3" /> },
          { label: 'Show Structure', action: 'show_structure', icon: <FileText className="h-3 w-3" /> }
        );
        break;
      case 'view':
      case 'materialized_view':
        actions.push(
          { label: 'Select Top 100 Rows', action: 'select_all', icon: <Eye className="h-3 w-3" /> },
          { label: 'View Definition', action: 'view_definition', icon: <Code className="h-3 w-3" /> }
        );
        break;
      case 'procedure':
        actions.push(
          { label: 'View Definition', action: 'procedure_definition', icon: <Code className="h-3 w-3" /> },
          { label: 'Execute Procedure', action: 'call_procedure', icon: <PlayCircle className="h-3 w-3" /> }
        );
        break;
      case 'function':
        actions.push(
          { label: 'View Definition', action: 'function_definition', icon: <Code className="h-3 w-3" /> }
        );
        break;
      case 'trigger':
        actions.push(
          { label: 'View Definition', action: 'trigger_definition', icon: <Code className="h-3 w-3" /> }
        );
        break;
    }
    
    return actions;
  };

  const handleContextMenuOpen = useCallback((e: React.MouseEvent, node: SchemaNode) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  }, []);

  return (
    <Layout>
      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
      <ConfirmActionModal
        open={dmlConfirmOpen}
        onClose={handleDmlCancel}
        onConfirm={handleDmlConfirm}
        message={t('chat.confirmDataChangeDesc')}
        explanation={dmlPending?.explanation}
        preview={
          dmlPending?.previewData
            ? {
                columns: dmlPending.previewData.columns,
                rows: dmlPending.previewData.rows,
                row_count: dmlPending.previewData.row_count,
              }
            : undefined
        }
        diff={{ sql: dmlPending?.sql }}
        isCreate={dmlPending?.isCreate ?? false}
        sql={dmlPending?.sql}
      />
      <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b bg-background flex-shrink-0">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <span className="text-xs font-semibold">SQL Chat</span>
          </div>
          <ConnectionDropdown
            value={selectedConnection}
            onValueChange={handleConnectionSelect}
            placeholder={t('chat.selectDatabase')}
            noConnectionsText={t('chat.noConnections')}
            className="w-[220px] h-7 text-[10px]"
          />
        </div>

        {/* Main Content */}
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          {/* Left: Schema Browser */}
          {!schemaBrowserCollapsed && (
            <>
              <ResizablePanel defaultSize={14} minSize={10} maxSize={25}>
                <div className="h-full flex flex-col overflow-hidden border-r bg-background">
                  <div className="flex items-center justify-between p-3 border-b flex-shrink-0 h-[52px]">
                    <h3 className="text-[10px] font-semibold">{t('chat.schemaBrowser')}</h3>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => loadSchema()}
                        className="h-7 w-7"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSchemaBrowserCollapsed(true)}
                        className="h-7 w-7"
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto">
                    <div className="p-2 min-w-max">
                      {schemaLoading ? (
                        <div className="text-[10px] text-muted-foreground text-center py-8">
                          Loading...
                        </div>
                      ) : (
                        <SchemaTree 
                          nodes={schemaTree}
                          expandedNodes={expandedNodes}
                          onToggleNode={toggleNode}
                          onLoadColumns={loadColumnsForNode}
                          onNodeAction={handleNodeAction}
                          onContextMenu={handleContextMenuOpen}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          {schemaBrowserCollapsed && (
            <div className="flex items-center justify-center w-10 border-r">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSchemaBrowserCollapsed(false)}
                className="h-7 w-7"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Middle: SQL Editor + Results */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* SQL Editor - 50% height */}
              <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Query File Tabs */}
                  <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 flex-shrink-0">
                    <div className="flex-1 overflow-x-auto">
                      <div className="flex gap-1 min-w-max">
                        {queryFiles.map(file => (
                          <div
                            key={file.id}
                            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-t cursor-pointer text-[9px] transition-colors ${
                              file.id === activeFileId
                                ? 'bg-background border border-b-0'
                                : 'bg-muted/50 hover:bg-muted'
                            }`}
                            onClick={() => setActiveFileId(file.id)}
                          >
                            <span className="whitespace-nowrap">{file.name}</span>
                            {queryFiles.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeQueryFile(file.id);
                                }}
                                className="hover:bg-destructive/20 rounded p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={addNewQueryFile}
                      className="h-6 w-6 flex-shrink-0"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  
                  {/* SQL Editor */}
                  <div className="flex-1 overflow-hidden">
                    <SQLEditor
                      key={activeFileId}
                      value={getCurrentFile().content}
                      onChange={(value) => updateFileContent(activeFileId, value)}
                      onExecute={(sql) => executeSQL(sql)}
                      dbType={selectedConnection ? connections.find(c => c.id === selectedConnection)?.type : 'postgresql'}
                      readOnly={false}
                      pendingChange={pendingChange ? {
                        id: pendingChange.messageId,
                        oldValue: pendingChange.oldSQL,
                        newValue: pendingChange.newSQL,
                        timestamp: new Date(),
                        explanation: '',
                      } : undefined}
                      onAcceptChange={() => {
                        if (pendingChange) {
                          handleAcceptChange(pendingChange.messageId, pendingChange.newSQL);
                        }
                      }}
                      onRejectChange={() => {
                        if (pendingChange) {
                          handleRejectChange(pendingChange.messageId);
                        }
                      }}
                      onCursorPositionChange={(line, column) => {
                        setCursorPosition({ line, column });
                      }}
                      schemaTree={schemaTree}
                      aiCompletionOptions={{
                        enabled: true,
                        connectionId: selectedConnection,
                        sessionId: sessionId || undefined,
                        language: i18n.language.split('-')[0],
                        supabaseClient: supabase,
                      }}
                    />
                  </div>
                </div>
              </ResizablePanel>
              
              <ResizableHandle />
              
              {/* Query Results Panel - 50% height */}
              <ResizablePanel defaultSize={50} minSize={20} maxSize={80}>
                <div className="h-full flex flex-col overflow-hidden border-t bg-background">
                  <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 flex-shrink-0">
                    <h3 className="text-[9px] font-semibold">Query Results ({queries.length})</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQueries([])}
                      className="h-5 text-[9px]"
                    >
                      Clear All
                    </Button>
                  </div>
                  <ScrollArea 
                    ref={queryResultsRef}
                    className="flex-1 min-h-0"
                  >
                  <div className="p-4 space-y-4">
                    {queries.length === 0 && (
                      <div className="text-[10px] text-muted-foreground text-center py-4">
                        No query results yet. Execute a query to see results here.
                      </div>
                    )}
                    {queries.map(query => (
                      <div key={query.id} className="p-4">
                        <div className="flex items-start gap-2 mb-2">
                          <span className={`text-[9px] px-1 py-0.5 rounded whitespace-nowrap ${
                            query.status === 'success' ? 'bg-green-500/10 text-green-600' :
                            query.status === 'error' ? 'bg-red-500/10 text-red-600' :
                            'bg-blue-500/10 text-blue-600'
                          }`}>
                            {query.status}
                          </span>
                          <pre className="text-[9px] bg-muted p-1 rounded flex-1 overflow-x-auto">
                            {query.sql}
                          </pre>
                        </div>
                        
                        {query.error && (
                          <div className="text-[9px] text-red-600 mt-2">{query.error}</div>
                        )}
                        
                        {query.results && query.columns && (
                          <>
                            <div className="mt-2 w-full overflow-x-auto">
                              <div className="min-w-max">
                                <table className="text-[9px] border border-collapse">
                                  <thead>
                                    <tr className="bg-muted">
                                      {query.columns.map(col => (
                                        <th key={col} className="px-1 py-0.5 text-left font-medium border whitespace-nowrap">
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {query.results.slice(0, rowsToShowByQuery[query.id] || 10).map((row, idx) => (
                                      <tr key={idx} className="border-b hover:bg-muted/50">
                                        {query.columns!.map(col => (
                                          <td key={col} className="px-1 py-0.5 border whitespace-nowrap">
                                            {String(row[col] ?? '')}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                            {query.results.length > 10 && (
                              <div className="flex items-center gap-2 mt-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-5 px-2 text-[9px]"
                                  onClick={() => {
                                    setRowsToShowByQuery(prev => ({
                                      ...prev,
                                      [query.id]: (prev[query.id] || 10) >= 100 ? 10 : 100,
                                    }));
                                  }}
                                >
                                  {(rowsToShowByQuery[query.id] || 10) >= 100 ? 'Show 10' : 'Show 100'}
                                </Button>
                                <div className="text-[9px] text-muted-foreground">
                                  Showing {Math.min(rowsToShowByQuery[query.id] || 10, query.results.length)} of {query.rowCount || query.results.length} rows
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right: AI Chat */}
          <ResizablePanel defaultSize={30} minSize={25} maxSize={40}>
            <div className="flex flex-col h-full overflow-hidden bg-background">
              <div className="flex items-center justify-between p-3 border-b flex-shrink-0 h-[52px]">
                <h3 className="text-[10px] font-semibold">AI Assistant</h3>
                <Select value={activeModel} onValueChange={(value: 'claude' | 'chatgpt') => setActiveModel(value)}>
                  <SelectTrigger className="w-[140px] h-7 text-[9px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude Sonnet 4.5</SelectItem>
                    <SelectItem value="chatgpt">GPT-5.2</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 min-h-0" ref={chatScrollAreaRef}>
                <div className="p-4 space-y-4">
                  {messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-primary/10 ml-8'
                          : 'bg-muted mr-8'
                      }`}
                    >
                      <div className="text-[9px] font-semibold mb-1">
                        {msg.role === 'user' ? 'You' : 'AI'}
                      </div>
                      <div className="text-[10px] whitespace-pre-wrap">{msg.content}</div>
                      {msg.role === 'assistant' && msg.chartData && (
                        <ChatChart
                          columns={msg.chartData.columns}
                          results={msg.chartData.results}
                          chartHint={msg.chartData.chartHint}
                        />
                      )}
                      {msg.pendingChange && (() => {
                        // Calculate compact diff - only show changed lines (memoized for performance)
                        const oldSQL = msg.pendingChange.oldSQL;
                        const newSQL = msg.pendingChange.newSQL;
                        
                        // Use memoized diff calculation
                        const lineDiffs = dmpInstance.diff_linesToChars_(oldSQL, newSQL);
                        const diffs = dmpInstance.diff_main(lineDiffs.chars1, lineDiffs.chars2, false);
                        dmpInstance.diff_charsToLines_(diffs, lineDiffs.lineArray);
                        dmpInstance.diff_cleanupSemantic(diffs);
                        
                        // Extract only changed lines
                        const oldLines = oldSQL.split('\n');
                        const newLines = newSQL.split('\n');
                        const changedLines: Array<{ type: 'delete' | 'insert'; content: string }> = [];
                        let oldIdx = 0;
                        let newIdx = 0;
                        
                        for (const [operation, text] of diffs) {
                          const lines = text.split('\n');
                          for (let i = 0; i < lines.length; i++) {
                            if (operation === DiffMatchPatch.DIFF_DELETE && oldIdx < oldLines.length) {
                              changedLines.push({ type: 'delete', content: oldLines[oldIdx] });
                              oldIdx++;
                            } else if (operation === DiffMatchPatch.DIFF_INSERT && newIdx < newLines.length) {
                              changedLines.push({ type: 'insert', content: newLines[newIdx] });
                              newIdx++;
                            } else if (operation === DiffMatchPatch.DIFF_EQUAL) {
                              oldIdx++;
                              newIdx++;
                            }
                          }
                        }
                        
                        return (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-[9px] text-muted-foreground mb-1">SQL Correction:</div>
                                <div className="space-y-0.5">
                                  {changedLines.map((line, idx) => (
                                    <div
                                      key={idx}
                                      className={`text-[9px] p-1 rounded ${
                                        line.type === 'delete'
                                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                          : 'bg-green-500/10 text-green-400 border border-green-500/20'
                                      }`}
                                    >
                                      {line.content}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1.5 flex-shrink-0">
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleAcceptChange(msg.id, msg.pendingChange!.newSQL)}
                                  className="h-5 px-2 text-[9px] bg-green-600 hover:bg-green-700 gap-1"
                                >
                                  <Check className="h-3 w-3" />
                                  Keep
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleRejectChange(msg.id)}
                                  className="h-5 px-2 text-[9px] gap-1"
                                >
                                  <X className="h-3 w-3" />
                                  Reject
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                  {loading && (
                    <div className="p-3 rounded-lg bg-muted mr-8">
                      <div className="text-[9px] font-semibold mb-1">AI</div>
                      <div className="text-[10px]">Thinking...</div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="p-3 border-t flex-shrink-0">
                <div className="flex gap-2 items-start">
                  <textarea
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    disabled={!sessionId || loading}
                    placeholder="Ask AI to write SQL..."
                    rows={1}
                    className="flex-1 text-[10px] min-h-[28px] max-h-[200px] resize-none rounded-md border border-input bg-background px-3 py-1.5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ overflowY: 'auto' }}
                  />
                  <Button
                    onClick={loading ? handleStopGeneration : handleSendMessage}
                    disabled={!sessionId || (!loading && !inputValue.trim())}
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    variant={loading ? "destructive" : "default"}
                  >
                    {loading ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-popover border rounded-md shadow-md py-1 min-w-[200px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {getContextMenuActions(contextMenu.node).map((item, idx) => (
              <button
                key={idx}
                className="w-full flex items-center gap-2 px-3 py-2 text-[10px] hover:bg-accent text-left"
                onClick={() => handleNodeAction(contextMenu.node, item.action)}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}
