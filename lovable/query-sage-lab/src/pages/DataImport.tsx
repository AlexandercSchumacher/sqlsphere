import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import Layout from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useConnection } from '@/hooks/useConnection';
import { supabase } from '@/integrations/supabase/client';
import { Upload, FileText, Loader2, CheckCircle, XCircle, AlertCircle, Trash2, Plus, History, HelpCircle, Settings2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';
import { ConnectionDropdown } from '@/components/ConnectionDropdown';

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface PreviewData {
  filename: string;
  file_type: string;
  total_rows: number;
  columns: string[];
  preview: Record<string, any>[];
}

interface Mapping {
  [csvColumn: string]: string; // csv_column -> db_column
}

interface ColumnConstraint {
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  defaultValue: string;
  foreignKeyTable: string;
  foreignKeyColumn: string;
}

// File upload validation constants
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_FILE_TYPES = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json'];
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.sql', '.json'];

// Sanitize filename to prevent path traversal
const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace special chars with underscore
    .replace(/\.{2,}/g, '.') // Remove consecutive dots
    .substring(0, 255); // Limit length
};

const DataImport = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { connections: sharedConnections, selectedConnectionId, selectConnection } = useConnection();
  const connections = sharedConnections as Connection[];
  const [selectedConnection, setSelectedConnectionLocal] = useState(selectedConnectionId || '');
  const [selectedTable, setSelectedTable] = useState('');
  const [selectedSchema, setSelectedSchema] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [fileColumns, setFileColumns] = useState<Array<{name: string, type: string}>>([]);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbColumnsWithTypes, setDbColumnsWithTypes] = useState<Array<{name: string, type: string, nullable: boolean}>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [createTableDialogOpen, setCreateTableDialogOpen] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableSchema, setNewTableSchema] = useState('');
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [columnNames, setColumnNames] = useState<Record<string, string>>({}); // Mapping: original name -> new name
  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [tableNameError, setTableNameError] = useState<string | null>(null);
  const [isCheckingTableName, setIsCheckingTableName] = useState(false);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [createNewTable, setCreateNewTable] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set()); // Columns that have been "deleted" (hidden)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duplicateHandling, setDuplicateHandling] = useState<'error' | 'skip' | 'update'>('error'); // How to handle duplicates: 'error' = fail, 'skip' = ignore, 'update' = update existing
  const [columnConstraints, setColumnConstraints] = useState<Record<string, ColumnConstraint>>({});
  const [fkColumnCache, setFkColumnCache] = useState<Record<string, string[]>>({});
  const [importHistory, setImportHistory] = useState<Array<{
    id: string;
    filename: string;
    table_name: string;
    schema_name: string | null;
    rows_imported: number;
    rows_failed: number;
    total_rows: number;
    duplicate_handling: string;
    created_at: string;
    connection_id: string | null;
    preview_data: {
      columns: string[];
      preview: Record<string, any>[];
      total_rows: number;
    } | null;
    mapping: Record<string, string> | null;
  }>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<typeof importHistory[0] | null>(null);
  const [historyPreviewDialogOpen, setHistoryPreviewDialogOpen] = useState(false);
  
  // File parsing settings dialog state
  const [parsingDialogOpen, setParsingDialogOpen] = useState(false);
  const [parsingSettings, setParsingSettings] = useState<{
    encoding: string;
    delimiter: string;
    headerRow: number | null; // null = auto, -1 = no headers, 0+ = row index
    skipRows: number | null;
  }>({
    encoding: 'utf-8',
    delimiter: ',',
    headerRow: null, // auto-detect
    skipRows: null
  });
  const [detectedSettings, setDetectedSettings] = useState<{
    encoding?: string;
    delimiter?: string;
    headerRow?: number;
  } | null>(null);
  const [rawFileContent, setRawFileContent] = useState<string | null>(null); // Store base64 for re-parsing
  const [currentFileType, setCurrentFileType] = useState<string>(''); // Store current file type (csv, xlsx, xls)

  // Sync selected connection from shared context
  useEffect(() => {
    if (selectedConnectionId && !selectedConnection) {
      setSelectedConnectionLocal(selectedConnectionId);
    }
  }, [selectedConnectionId]);

  // Load import history
  const loadImportHistory = async () => {
    if (!user) return;
    
    setIsLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('import_history')
        .select('id, filename, table_name, schema_name, rows_imported, rows_failed, total_rows, duplicate_handling, created_at, connection_id, preview_data, mapping')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50); // Show last 50 imports

      if (error) {
        console.error('Error loading import history:', error);
        return;
      }

      setImportHistory((data || []) as Array<{
        id: string;
        filename: string;
        table_name: string;
        schema_name: string | null;
        rows_imported: number;
        rows_failed: number;
        total_rows: number;
        duplicate_handling: string;
        created_at: string;
        connection_id: string | null;
        preview_data: {
          columns: string[];
          preview: Record<string, any>[];
          total_rows: number;
        } | null;
        mapping: Record<string, string> | null;
      }>);
    } catch (err) {
      console.error('Error loading import history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Load history on mount and when user changes
  useEffect(() => {
    if (user) {
      loadImportHistory();
    }
  }, [user]);

  // Load schemas and tables when connection changes
  useEffect(() => {
    if (!selectedConnection) {
      setSchemas([]);
      setTables([]);
      return;
    }

    const loadSchemaData = async () => {
      try {
        const { data: connection } = await supabase
          .from('connections')
          .select('*')
          .eq('id', selectedConnection)
          .eq('user_id', user?.id)
          .single();

        if (!connection) return;

        // Get connection params
        const connectionPayload = {
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          password: connection.password, // Will be decrypted by Edge Function
          connectionMethod: connection.connection_method || 'standard',
          useSSL: connection.use_ssl || false,
          type: connection.type.toLowerCase(),
          defaultSchema: connection.default_schema || null,
        };

        // Load tables via database-proxy
        const { data, error } = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/tables',
            connectionId: selectedConnection,
          }
        });

        if (error) {
          console.error('Error loading tables:', error);
          return;
        }

        // Extract unique schemas and tables
        const allTables = data.tables || [];
        const uniqueSchemas = [...new Set(allTables.map((t: any) => t.schema).filter(Boolean))];
        setSchemas(uniqueSchemas as string[]);
        setTables(allTables.map((t: any) => t.name));
      } catch (error) {
        console.error('Error loading schema data:', error);
      }
    };

    loadSchemaData();
  }, [selectedConnection, user]);

  // Re-analyze file when connection changes
  useEffect(() => {
    if (file && selectedConnection) {
      handleAnalyzeFile(file);
    }
  }, [selectedConnection]);

  // Handle file selection (just store the file, don't preview yet)
  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile) return;

    // Validate file extension first (more reliable than MIME type)
    const fileExtension = selectedFile.name.toLowerCase().substring(selectedFile.name.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      toast({
        title: 'Invalid file extension',
        description: 'Please upload a CSV, Excel, SQL, or JSON file (.csv, .xlsx, .xls, .sql, .json)',
        variant: 'destructive',
      });
      return;
    }

    // Validate file type by MIME type (only for non-SQL files, as SQL files often don't have a consistent MIME type)
    // SQL files (.sql) are allowed regardless of MIME type since browsers may not recognize them correctly
    if (fileExtension !== '.sql' && !ALLOWED_FILE_TYPES.includes(selectedFile.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a CSV, Excel, SQL, or JSON file (.csv, .xlsx, .xls, .sql, .json)',
        variant: 'destructive',
      });
      return;
    }

    // Validate file size (25 MB max)
    if (selectedFile.size > MAX_FILE_SIZE) {
      toast({
        title: 'File too large',
        description: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        variant: 'destructive',
      });
      return;
    }

    // Sanitize filename
    const sanitizedName = sanitizeFilename(selectedFile.name);
    if (sanitizedName !== selectedFile.name) {
      console.warn(`Filename sanitized from "${selectedFile.name}" to "${sanitizedName}"`);
    }

    // Store the file
    setFile(selectedFile);
    setPreviewData(null);
    setMapping({});
    setImportResult(null);
    setFileColumns([]);
    setColumnNames({}); // Reset column name mappings when new file is selected
    setColumnTypes({}); // Reset column types when new file is selected
    
    // Analyze file columns immediately if connection is selected
    // Otherwise, the useEffect hook will trigger analysis when connection is selected
    if (selectedConnection) {
      handleAnalyzeFile(selectedFile);
    }
  };

  // Analyze file to extract columns and types
  const handleAnalyzeFile = async (fileToAnalyze: File, useSettings: boolean = false) => {
    if (!fileToAnalyze || !selectedConnection) {
      console.warn('Cannot analyze file: missing file or connection');
      return;
    }

    setIsAnalyzingFile(true);

    try {
      // Get connection details
      const { data: connection, error: connectionError } = await supabase
        .from('connections')
        .select('*')
        .eq('id', selectedConnection)
        .eq('user_id', user?.id)
        .single();

      if (connectionError || !connection) {
        throw new Error(connectionError?.message || 'Connection not found');
      }

      // Read file as base64 (optimized for large files)
      const fileContent = await fileToAnalyze.arrayBuffer();
      const uint8Array = new Uint8Array(fileContent);
      
      // Convert to base64 in small chunks to avoid stack overflow
      let binaryString = '';
      const chunkSize = 1024; // Process in 1KB chunks to avoid call stack issues
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        // Convert chunk without spread operator to avoid stack overflow
        for (let j = 0; j < chunk.length; j++) {
          binaryString += String.fromCharCode(chunk[j]);
        }
      }
      const base64Content = btoa(binaryString);

      // Store raw file content for re-parsing
      if (!useSettings) {
        setRawFileContent(base64Content);
      }

      // Sanitize filename before sending
      const sanitizedFilename = sanitizeFilename(fileToAnalyze.name);

      // Validate base64 content
      if (!base64Content || base64Content.length === 0) {
        throw new Error('Failed to convert file to base64');
      }

      console.log('Sending file to Edge Function:', {
        filename: sanitizedFilename,
        base64Length: base64Content.length,
        fileSize: fileToAnalyze.size,
        useSettings,
        settings: useSettings ? parsingSettings : null
      });

      // Prepare request body with parsing settings if provided
      const requestBody: any = {
        endpoint: '/upload/preview',
        connectionId: selectedConnection,
        file: base64Content,
        filename: sanitizedFilename,
      };

      // Add parsing parameters if using custom settings
      if (useSettings) {
        // Only send encoding and delimiter for CSV files, encoding for SQL files
        const isCsv = fileToAnalyze.name.toLowerCase().endsWith('.csv');
        const isSql = fileToAnalyze.name.toLowerCase().endsWith('.sql');
        if (isCsv) {
          if (parsingSettings.encoding) requestBody.encoding = parsingSettings.encoding;
          if (parsingSettings.delimiter) requestBody.delimiter = parsingSettings.delimiter;
        } else if (isSql) {
          if (parsingSettings.encoding) requestBody.encoding = parsingSettings.encoding;
        }
        // Header row and skip rows apply to all file types
        if (parsingSettings.headerRow !== null) requestBody.header_row = parsingSettings.headerRow;
        if (parsingSettings.skipRows !== null) requestBody.skip_rows = parsingSettings.skipRows;
      }

      // Analyze file via database-proxy (only get columns, not full preview)
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: requestBody
      });

      if (error) {
        console.error('Edge Function error:', error);
        throw new Error(error.message || `Edge Function returned a non-2xx status code: ${error.message || 'Unknown error'}`);
      }

      if (!data) {
        throw new Error('No data received from server');
      }

      // Store file type
      const fileExt = fileToAnalyze.name.toLowerCase();
      if (fileExt.endsWith('.csv')) {
        setCurrentFileType('csv');
      } else if (fileExt.endsWith('.xlsx')) {
        setCurrentFileType('xlsx');
      } else if (fileExt.endsWith('.xls')) {
        setCurrentFileType('xls');
      } else if (fileExt.endsWith('.sql')) {
        setCurrentFileType('sql');
      }
      
      // Store detected settings if provided
      if (data.detected_settings && !useSettings) {
        setDetectedSettings(data.detected_settings);
        // Pre-fill parsing settings with detected values
        setParsingSettings({
          encoding: data.detected_settings.encoding || 'utf-8',
          delimiter: data.detected_settings.delimiter || ',',
          headerRow: data.detected_settings.header_row !== undefined ? data.detected_settings.header_row : null,
          skipRows: null
        });
      }

      // Extract columns and infer types from preview data
      if (data && data.columns) {
        const columnsWithTypes: Array<{name: string, type: string}> = [];
        
        data.columns.forEach((col: string) => {
          // Try to infer type from preview data - check multiple rows for better accuracy
          let inferredType = 'TEXT';
          if (data.preview && data.preview.length > 0) {
            // Check multiple rows to detect floats more accurately
            let hasFloat = false;
            let hasInteger = false;
            let hasText = false;
            let hasDate = false;
            let hasDateTime = false;
            let hasBoolean = false;
            
            // Check up to 1000 rows for better type detection
            // Use type_detection_data if available (up to 1000 rows), otherwise fall back to preview
            const typeDetectionData = data.type_detection_data || data.preview;
            const rowsToCheck = Math.min(1000, typeDetectionData.length);
            for (let i = 0; i < rowsToCheck; i++) {
              const sampleValue = typeDetectionData[i][col];
              if (sampleValue !== null && sampleValue !== undefined) {
                const valueStr = String(sampleValue).trim();
                
                // Check for numeric values
                if (!isNaN(Number(valueStr)) && valueStr !== '') {
                  // Check if it's a float (has decimal point or comma, or scientific notation)
                  if (valueStr.includes('.') || valueStr.includes(',') || valueStr.includes('e') || valueStr.includes('E')) {
                    hasFloat = true;
                  } else {
                    hasInteger = true;
                  }
                } else if (valueStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                  hasDate = true;
                } else if (valueStr.match(/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/)) {
                  hasDateTime = true;
                } else if (valueStr.toLowerCase() === 'true' || valueStr.toLowerCase() === 'false') {
                  hasBoolean = true;
                } else if (valueStr !== '') {
                  hasText = true;
                }
              }
            }
            
            // Determine type based on what we found
            if (hasFloat) {
              // If we found any float, use REAL (even if there are also integers)
              inferredType = 'REAL';
            } else if (hasInteger && !hasText) {
              inferredType = 'INTEGER';
            } else if (hasDateTime) {
              inferredType = 'DATETIME';
            } else if (hasDate) {
              inferredType = 'DATE';
            } else if (hasBoolean && !hasText) {
              inferredType = 'BOOLEAN';
            } else {
              inferredType = 'TEXT';
            }
          }
          
          columnsWithTypes.push({
            name: col,
            type: inferredType
          });
        });
        
        setFileColumns(columnsWithTypes);
        setPreviewData(data);
        
        // Initialize column types for new table creation
        const initialTypes: Record<string, string> = {};
        columnsWithTypes.forEach((col) => {
          initialTypes[col.name] = col.type;
        });
        setColumnTypes(initialTypes);
        
        // Open parsing dialog for all supported file types (only on first analysis, not when re-parsing with settings)
        const fileExtension = fileToAnalyze.name.toLowerCase();
        const isSupportedFile = fileExtension.endsWith('.csv') || fileExtension.endsWith('.xlsx') || fileExtension.endsWith('.xls') || fileExtension.endsWith('.sql');
        
        if (!useSettings && isSupportedFile) {
          setParsingDialogOpen(true);
        } else {
          toast({
            title: 'File analyzed',
            description: `Found ${columnsWithTypes.length} columns`,
          });
        }
        
        // If table is selected, load mapping suggestions
        if (selectedTable) {
          await loadMappingSuggestions(data.columns);
        }
      } else {
        throw new Error('No columns found in file');
      }
    } catch (error: any) {
      console.error('Error analyzing file:', error);
      toast({
        title: 'Error analyzing file',
        description: error.message || 'Failed to analyze file',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  // Handle updating preview only (without closing dialog)
  const handleUpdatePreview = async () => {
    if (!file || !rawFileContent) {
      toast({
        title: 'Error',
        description: 'File not available',
        variant: 'destructive',
      });
      return;
    }

    // Re-analyze with new settings but keep dialog open
    await handleAnalyzeFile(file, true);
  };

  // Handle applying parsing settings and closing dialog
  const handleApplyParsingSettings = async () => {
    if (!file || !rawFileContent) {
      toast({
        title: 'Error',
        description: 'File not available',
        variant: 'destructive',
      });
      return;
    }

    // Re-analyze with new settings
    await handleAnalyzeFile(file, true);
    setParsingDialogOpen(false);
    
    toast({
      title: 'Settings applied',
      description: 'File re-analyzed with new parsing settings',
    });
  };

  // Handle file deletion
  const handleDeleteFile = () => {
    setFile(null);
    setFileColumns([]);
    setPreviewData(null);
    setMapping({});
    setImportResult(null);
    setColumnTypes({});
    setColumnNames({}); // Reset column name mappings when file is deleted
    setHiddenColumns(new Set()); // Reset hidden columns when file is deleted
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle preview generation (shows actual data with mapping applied)
  const handlePreview = async () => {
    if (!file || !selectedConnection) {
      toast({
        title: 'Missing information',
        description: 'Please select a file and database connection',
        variant: 'destructive',
      });
      return;
    }

    // Filter out hidden columns from mapping check
    const activeMapping = Object.fromEntries(
      Object.entries(mapping).filter(([key]) => !hiddenColumns.has(key))
    );
    
    if (!createNewTable && selectedTable && Object.keys(activeMapping).filter(k => activeMapping[k]).length === 0) {
      toast({
        title: 'No mapping',
        description: 'Please map at least one column',
        variant: 'destructive',
      });
      return;
    }

    if (createNewTable && !newTableName.trim()) {
      toast({
        title: 'Missing table name',
        description: 'Please enter a name for the new table',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    setPreviewData(null);
    setImportResult(null);

    try {
      // Get connection details
      const { data: connection } = await supabase
        .from('connections')
        .select('*')
        .eq('id', selectedConnection)
        .eq('user_id', user?.id)
        .single();

      if (!connection) {
        throw new Error('Connection not found');
      }

      // Read file as base64 (optimized for large files)
      const fileContent = await file.arrayBuffer();
      const uint8Array = new Uint8Array(fileContent);
      
      // Convert to base64 in small chunks to avoid stack overflow
      let binaryString = '';
      const chunkSize = 1024; // Process in 1KB chunks to avoid call stack issues
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        // Convert chunk without spread operator to avoid stack overflow
        for (let j = 0; j < chunk.length; j++) {
          binaryString += String.fromCharCode(chunk[j]);
        }
      }
      const base64Content = btoa(binaryString);

      // Sanitize filename before sending
      const sanitizedFilename = sanitizeFilename(file.name);

      // Preview file via database-proxy
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/upload/preview',
          connectionId: selectedConnection,
          file: base64Content,
          filename: sanitizedFilename,
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to preview file');
      }

      // Transform preview data based on mapping
      // Filter out hidden columns from mapping
      const activeMapping = Object.fromEntries(
        Object.entries(mapping).filter(([key]) => !hiddenColumns.has(key))
      );
      
      if (!createNewTable && selectedTable && Object.keys(activeMapping).length > 0) {
        // Get target column names (only mapped ones)
        const targetColumns = Object.values(activeMapping).filter(col => col && col !== '__skip__');
        
        // Transform preview data: map CSV columns to target columns
        const transformedPreview = data.preview.map((row: Record<string, any>) => {
          const transformedRow: Record<string, any> = {};
          // For each mapped CSV column, add it to the transformed row with the target column name
          Object.entries(activeMapping).forEach(([csvCol, targetCol]) => {
            if (targetCol && targetCol !== '__skip__' && row[csvCol] !== undefined) {
              transformedRow[targetCol] = row[csvCol];
            }
          });
          return transformedRow;
        });

        // Update preview data with transformed columns and data
        setPreviewData({
          ...data,
          columns: targetColumns,
          preview: transformedPreview,
          sample_data: transformedPreview
        });
      } else if (createNewTable) {
        // For new tables, use the column types configuration
        // Filter out hidden columns
        const newTableColumns = fileColumns
          .filter((col) => !hiddenColumns.has(col.name))
          .map(col => col.name);
        setPreviewData({
          ...data,
          columns: newTableColumns,
          preview: data.preview.map((row: Record<string, any>) => {
            const transformedRow: Record<string, any> = {};
            newTableColumns.forEach(col => {
              transformedRow[col] = row[col];
            });
            return transformedRow;
          }),
          sample_data: data.preview
        });
      } else {
        // No mapping, show raw data
        setPreviewData(data);
      }
    } catch (error: any) {
      toast({
        title: 'Error previewing file',
        description: error.message || 'Failed to preview file',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Load mapping suggestions when table is selected
  const loadMappingSuggestions = async (csvColumns: string[]) => {
    if (!selectedConnection || !selectedTable || !csvColumns || !csvColumns.length) {
      console.log('loadMappingSuggestions: Missing requirements', {
        hasConnection: !!selectedConnection,
        hasTable: !!selectedTable,
        hasColumns: !!csvColumns && csvColumns.length > 0
      });
      return;
    }

    try {
      console.log('loadMappingSuggestions: Loading mapping for table', selectedTable);
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/upload/mapping',
          connectionId: selectedConnection,
          table_name: selectedTable,
          schema: selectedSchema || null,
          csv_columns: JSON.stringify(csvColumns),
        }
      });

      if (error) {
        console.error('Error loading mapping:', error);
        return;
      }

      if (data) {
        console.log('loadMappingSuggestions: Received data', {
          mappingKeys: Object.keys(data.mapping || {}),
          dbColumnsCount: (data.db_columns || []).length,
          dbColumns: data.db_columns,
          dbColumnsWithTypes: data.db_columns_with_types
        });
        setMapping(data.mapping || {});
        setDbColumns(data.db_columns || []);
        // Store full column information with types
        if (data.db_columns_with_types) {
          setDbColumnsWithTypes(data.db_columns_with_types);
        } else if (data.db_columns) {
          // Fallback: create array with just names if types not provided
          setDbColumnsWithTypes(data.db_columns.map((name: string) => ({ name, type: 'unknown', nullable: true })));
        }
      } else {
        console.warn('loadMappingSuggestions: No data received');
      }
    } catch (error) {
      console.error('Error loading mapping suggestions:', error);
    }
  };

  // Handle table selection change - load DB columns for mapping
  useEffect(() => {
    console.log('useEffect: Table selection changed', {
      createNewTable,
      selectedTable,
      fileColumnsLength: fileColumns.length,
      selectedSchema
    });
    
    if (!createNewTable && selectedTable && fileColumns.length > 0) {
      const csvColumnNames = fileColumns.map(col => col.name);
      console.log('useEffect: Calling loadMappingSuggestions with', csvColumnNames);
      loadMappingSuggestions(csvColumnNames);
    } else {
      // Clear mapping if no table selected or creating new table
      console.log('useEffect: Clearing mapping');
      setMapping({});
      setDbColumns([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable, selectedSchema, createNewTable, fileColumns.length]);

  // Handle create table
  const handleCreateTable = async () => {
    if (!newTableName.trim() || !selectedConnection) {
      toast({
        title: 'Missing information',
        description: 'Please enter a table name',
        variant: 'destructive',
      });
      return;
    }

    // Use fileColumns if previewData is not available
    const columnsToUse = previewData?.columns || fileColumns.map(fc => fc.name);
    if (!columnsToUse || columnsToUse.length === 0) {
      toast({
        title: 'Missing information',
        description: 'Please upload and analyze a file first',
        variant: 'destructive',
      });
      return;
    }

    setIsCreatingTable(true);

    try {
      // Create table via database-proxy
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/upload/create-table',
          connectionId: selectedConnection,
          table_name: newTableName.trim(),
          schema: newTableSchema || null,
          columns: columnsToUse
            .filter((col) => !hiddenColumns.has(col))
            .map((col) => {
              const c = columnConstraints[col] || {} as ColumnConstraint;
              return {
                name: columnNames[col] || col,
                type: columnTypes[col] || fileColumns.find(fc => fc.name === col)?.type || 'TEXT',
                primaryKey: c.primaryKey || false,
                notNull: c.notNull || false,
                unique: c.unique || false,
                defaultValue: c.defaultValue || null,
                foreignKeyTable: c.foreignKeyTable || null,
                foreignKeyColumn: c.foreignKeyColumn || null,
              };
            }),
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to create table');
      }

      toast({
        title: 'Table created',
        description: `Table "${newTableName}" created successfully`,
      });

      // Set the newly created table as selected
      const createdTableName = newTableName.trim();
      const createdSchema = newTableSchema || '';
      setSelectedTable(createdTableName);
      setSelectedSchema(createdSchema);
      
      // Refresh tables list
      const loadSchemaData = async () => {
        try {
          const { data: connection } = await supabase
            .from('connections')
            .select('*')
            .eq('id', selectedConnection)
            .eq('user_id', user?.id)
            .single();

          if (!connection) return;

          const { data: tablesData, error: tablesError } = await supabase.functions.invoke('database-proxy', {
            body: {
              endpoint: '/tables',
              connectionId: selectedConnection,
            }
          });

          if (!tablesError && tablesData?.tables) {
            const allTables = tablesData.tables || [];
            const uniqueSchemas = [...new Set(allTables.map((t: any) => t.schema).filter(Boolean))];
            setSchemas(uniqueSchemas as string[]);
            setTables(allTables.map((t: any) => t.name));
          }
        } catch (error) {
          console.error('Error refreshing tables:', error);
        }
      };

      await loadSchemaData();

      // Close dialog
      setCreateTableDialogOpen(false);

      // Load mapping suggestions for the new table - this will create automatic 1:1 mapping
      if (columnsToUse.length > 0) {
        await loadMappingSuggestions(columnsToUse);
      }

      // Switch to "existing table" mode so Column Mapping is shown
      // This allows user to see and adjust the mapping before importing
      setCreateNewTable(false);
      
      // Keep table name and schema for import (they're already set in selectedTable/selectedSchema)
      // Don't reset newTableName and newTableSchema yet - they might be needed for import
      // But we can reset columnTypes since they're only needed for table creation
      setColumnTypes({});
    } catch (error: any) {
      toast({
        title: 'Failed to create table',
        description: error.message || 'Failed to create table',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingTable(false);
    }
  };

  // Initialize column types when preview data changes
  useEffect(() => {
    if (previewData && previewData.columns && Object.keys(columnTypes).length === 0) {
      const initialTypes: Record<string, string> = {};
      previewData.columns.forEach((col) => {
        // Try to infer type from preview data
        if (previewData.preview && previewData.preview.length > 0) {
          const sampleValue = previewData.preview[0][col];
          if (sampleValue !== null && sampleValue !== undefined) {
            const valueStr = String(sampleValue);
            if (!isNaN(Number(valueStr)) && valueStr.trim() !== '') {
              initialTypes[col] = 'INTEGER';
            } else if (valueStr.match(/^\d{4}-\d{2}-\d{2}/)) {
              initialTypes[col] = 'DATE';
            } else {
              initialTypes[col] = 'TEXT';
            }
          } else {
            initialTypes[col] = 'TEXT';
          }
        } else {
          initialTypes[col] = 'TEXT';
        }
      });
      setColumnTypes(initialTypes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewData?.columns?.length]);

  const fetchColumnsForFkTable = async (tableName: string): Promise<string[]> => {
    if (fkColumnCache[tableName]) return fkColumnCache[tableName];
    try {
      const { data } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: '/upload/mapping',
          connectionId: selectedConnection,
          table_name: tableName,
          csv_columns: JSON.stringify([]),
        },
      });
      const cols: string[] = (data?.db_columns || []);
      setFkColumnCache((prev) => ({ ...prev, [tableName]: cols }));
      return cols;
    } catch {
      return [];
    }
  };

  // Handle import
  const handleImport = async () => {
    if (!file || !selectedConnection || !previewData) {
      toast({
        title: 'Missing information',
        description: 'Please select a file, connection, and preview the data',
        variant: 'destructive',
      });
      return;
    }

    // Determine target table
    const targetTable = createNewTable ? newTableName : selectedTable;
    const targetSchema = createNewTable ? newTableSchema : selectedSchema;

    if (!targetTable) {
      toast({
        title: 'Missing information',
        description: createNewTable 
          ? 'Please enter a table name'
          : 'Please select a target table',
        variant: 'destructive',
      });
      return;
    }

    // If creating new table, create it first
    if (createNewTable) {
      // Use fileColumns to get column names and types
      // Apply user-modified column names if available
      const columnsToUse = fileColumns
        .filter((col) => !hiddenColumns.has(col.name))
        .map((col) => {
          const c = columnConstraints[col.name] || {} as ColumnConstraint;
          return {
            name: columnNames[col.name] || col.name,
            type: columnTypes[col.name] || col.type || 'TEXT',
            primaryKey: c.primaryKey || false,
            notNull: c.notNull || false,
            unique: c.unique || false,
            defaultValue: c.defaultValue || null,
            foreignKeyTable: c.foreignKeyTable || null,
            foreignKeyColumn: c.foreignKeyColumn || null,
          };
        });

      if (columnsToUse.length === 0) {
        toast({
          title: 'Missing information',
          description: 'Please ensure at least one column is available',
          variant: 'destructive',
        });
        return;
      }

      try {
        // Create table via database-proxy
        const { data: createData, error: createError } = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/upload/create-table',
            connectionId: selectedConnection,
            table_name: newTableName.trim(),
            schema: newTableSchema || null,
            columns: columnsToUse,
          }
        });

        if (createError) {
          throw new Error(createError.message || 'Failed to create table');
        }

        // Set the newly created table as selected
        setSelectedTable(newTableName.trim());
        setSelectedSchema(newTableSchema || '');
        
        // Create automatic 1:1 mapping for new table and store it
        const autoMapping: Mapping = {};
        columnsToUse.forEach((col) => {
          autoMapping[col.name] = col.name; // 1:1 mapping
        });
        setMapping(autoMapping);
        
        // Store mapping for use in import (before switching to existing table mode)
        // We'll use this mapping in the import step below

        // Refresh tables list
        const loadSchemaData = async () => {
          try {
            const { data: connection } = await supabase
              .from('connections')
              .select('*')
              .eq('id', selectedConnection)
              .eq('user_id', user?.id)
              .single();

            if (!connection) return;

            const { data: tablesData, error: tablesError } = await supabase.functions.invoke('database-proxy', {
              body: {
                endpoint: '/tables',
                connectionId: selectedConnection,
              }
            });

            if (!tablesError && tablesData?.tables) {
              const allTables = tablesData.tables || [];
              const uniqueSchemas = [...new Set(allTables.map((t: any) => t.schema).filter(Boolean))];
              setSchemas(uniqueSchemas as string[]);
              setTables(allTables.map((t: any) => t.name));
            }
          } catch (error) {
            console.error('Error refreshing tables:', error);
          }
        };

        await loadSchemaData();

        // Don't switch to existing table mode yet - we need createNewTable to stay true
        // so the import logic knows to use newTableName and create auto-mapping
        // setCreateNewTable(false); // Will be set after successful import

        toast({
          title: 'Table created',
          description: `Table "${newTableName}" created successfully. Now importing data...`,
        });
      } catch (error: any) {
        toast({
          title: 'Failed to create table',
          description: error.message || 'Failed to create table',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }
    }

    // For new tables, create automatic 1:1 mapping
    // For existing tables, use the mapping from state (or create 1:1 if empty)
    let activeMapping: Mapping = {};
    
    if (createNewTable) {
      // For new tables: create mapping from original file column names to new table column names
      // Original column name (from file) -> New column name (user-renamed)
      const activeFileCols = fileColumns.filter((col) => !hiddenColumns.has(col.name));
      activeMapping = Object.fromEntries(
        activeFileCols.map((col) => {
          const newColumnName = columnNames[col.name] || col.name;
          return [col.name, newColumnName]; // Map original name to new name
        })
      );
    } else {
      // For existing tables: use mapping from state, or create 1:1 if empty
      if (Object.keys(mapping).length === 0) {
        // No mapping exists, create 1:1 mapping
        const activeFileCols = fileColumns.filter((col) => !hiddenColumns.has(col.name));
        activeMapping = Object.fromEntries(
          activeFileCols.map((col) => [col.name, col.name])
        );
      } else {
        // Filter out hidden columns from existing mapping
        activeMapping = Object.fromEntries(
          Object.entries(mapping).filter(([key]) => !hiddenColumns.has(key))
        );
      }
    }

    if (Object.keys(activeMapping).length === 0) {
      toast({
        title: 'No columns',
        description: 'Please ensure at least one column is available',
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      // Sanitize filename before sending
      const sanitizedFilename = sanitizeFilename(file.name);
      
      // Security: Validate user ID before using it in path
      if (!user?.id) {
        toast({
          title: 'Authentication required',
          description: 'You must be logged in to upload files',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }
      
      // Security: Validate user ID format (should be UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(user.id)) {
        toast({
          title: 'Invalid user ID',
          description: 'User ID format is invalid',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }
      
      // For large files, upload to Supabase Storage first to avoid Edge Function payload limits
      // Generate a unique file path with validated user ID
      const filePath = `imports/${user.id}/${Date.now()}_${sanitizedFilename}`;
      
      // Security: Final validation of file path (should not contain path traversal)
      if (filePath.includes('..') || filePath.includes('\\')) {
        toast({
          title: 'Invalid file path',
          description: 'File path contains invalid characters',
          variant: 'destructive',
        });
        setIsImporting(false);
        return;
      }
      
      // Read file as ArrayBuffer
      const fileContent = await file.arrayBuffer();
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('imports')
        .upload(filePath, fileContent, {
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });
      
      // Declare variables outside if/else to ensure they're in scope
      let data: any;
      let importTableName: string;
      let importSchema: string | null;
      let activeFileColumns: any[];
      
      // Use the actual path returned from Supabase Storage (more reliable than filePath)
      const actualStoragePath = uploadData?.path || filePath;
      
      // Debug: Log upload result
      if (uploadError) {
        console.error('Storage upload error:', uploadError);
      } else {
        console.log('Storage upload successful:', {
          requestedPath: filePath,
          actualPath: actualStoragePath,
          uploadData: uploadData
        });
      }
      
      if (uploadError) {
        // If storage upload fails, check if it's a bucket/policy issue
        console.error('Storage upload failed:', uploadError);
        const fileSizeMB = file.size / 1024 / 1024;
        
        // Check for specific error types
        const errorMessage = uploadError.message || '';
        const isBucketNotFound = errorMessage.includes('Bucket not found') || 
                                  errorMessage.includes('not found') ||
                                  errorMessage.includes('The resource was not found');
        
        if (isBucketNotFound) {
          toast({
            title: 'Storage bucket not configured',
            description: 'Please create a bucket named "imports" in Supabase Storage. Go to Storage → Create Bucket → Name: "imports" → Public: No → Allow authenticated users to upload',
            variant: 'destructive',
          });
          setIsImporting(false);
          return;
        }
        
        // For large files (>5MB), don't fall back to base64 - it will fail anyway
        if (fileSizeMB > 5) {
          toast({
            title: 'Storage upload failed',
            description: `File is ${fileSizeMB.toFixed(2)} MB. Storage upload failed: ${errorMessage}. Please ensure the "imports" bucket exists and has correct permissions.`,
            variant: 'destructive',
          });
          setIsImporting(false);
          return;
        }
        
        // Only fall back to base64 for small files (< 5MB)
        console.warn('Storage upload failed, falling back to base64 for small file:', uploadError);
        toast({
          title: 'Warning',
          description: 'Storage upload failed, using alternative method. This may fail for large files.',
          variant: 'default',
        });
        
        // Convert to base64 in small chunks to avoid stack overflow
        const uint8Array = new Uint8Array(fileContent);
        let binaryString = '';
        const chunkSize = 1024; // Process in 1KB chunks
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          for (let j = 0; j < chunk.length; j++) {
            binaryString += String.fromCharCode(chunk[j]);
          }
        }
        const base64Content = btoa(binaryString);

        // Include fileColumns with user-modified types for data conversion
        // Filter out hidden columns from fileColumns and mapping
        activeFileColumns = fileColumns.filter((col) => !hiddenColumns.has(col.name));
        
        // Determine table name and schema for import
        importTableName = createNewTable ? newTableName.trim() : selectedTable;
        importSchema = createNewTable ? (newTableSchema || null) : (selectedSchema || null);
        
        const result = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/upload/import',
            connectionId: selectedConnection,
            table_name: importTableName,
            schema: importSchema,
            file: base64Content,
            filename: sanitizedFilename,
            mapping: JSON.stringify(activeMapping),
            file_columns: JSON.stringify(activeFileColumns),
            duplicate_handling: createNewTable ? 'error' : duplicateHandling, // Don't use duplicate handling for new tables
          }
        });

        if (result.error) {
          throw new Error(result.error.message || 'Failed to import file');
        }

        data = result.data;
        setImportResult(data);
      } else {
        // Storage upload successful - use the path returned from Supabase
        if (!actualStoragePath) {
          toast({
            title: 'Upload error',
            description: 'File was uploaded but no path was returned. Please try again.',
            variant: 'destructive',
          });
          setIsImporting(false);
          return;
        }
        
        // Storage upload successful - send storage path instead of base64
        // Include fileColumns with user-modified types and names for data conversion
        // Filter out hidden columns from fileColumns and mapping
        // Apply user-modified column names if available
        activeFileColumns = fileColumns
          .filter((col) => !hiddenColumns.has(col.name))
          .map((col) => ({
            name: columnNames[col.name] || col.name, // Use renamed column if available
            type: columnTypes[col.name] || col.type,
          }));
        
        // Determine table name and schema for import
        importTableName = createNewTable ? newTableName.trim() : selectedTable;
        importSchema = createNewTable ? (newTableSchema || null) : (selectedSchema || null);
        
        const result = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/upload/import',
            connectionId: selectedConnection,
            table_name: importTableName,
            schema: importSchema,
            storage_path: actualStoragePath, // Use actual path from Storage upload response
            filename: sanitizedFilename,
            mapping: JSON.stringify(activeMapping),
            file_columns: JSON.stringify(activeFileColumns),
            duplicate_handling: createNewTable ? 'error' : duplicateHandling, // Don't use duplicate handling for new tables
          }
        });

        if (result.error) {
          // Clean up uploaded file on error
          await supabase.storage.from('imports').remove([actualStoragePath]);
          throw new Error(result.error.message || 'Failed to import file');
        }

        data = result.data;
        
        // Check if this is an async job (large file processing)
        if (data.status === 'processing' && data.job_id) {
          console.log('Import started in background, polling for completion:', data.job_id);
          toast({
            title: 'Import in progress',
            description: 'Large file import started. This may take a few minutes...',
          });
          
          // Poll for completion
          const pollInterval = 3000; // 3 seconds
          const maxPolls = 120; // 6 minutes max
          let polls = 0;
          
          while (polls < maxPolls) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            polls++;
            
            const statusResult = await supabase.functions.invoke('database-proxy', {
              body: {
                endpoint: '/upload/import-status',
                connectionId: selectedConnection,
                job_id: data.job_id,
              }
            });
            
            if (statusResult.error) {
              console.error('Error polling import status:', statusResult.error);
              continue;
            }
            
            const statusData = statusResult.data;
            console.log('Import status poll:', polls, statusData);
            
            if (statusData.status === 'complete' || statusData.status === 'error') {
              data = statusData;
              // Don't save to history here - edge function already saved it
              break;
            }
          }
          
          if (polls >= maxPolls && data.status === 'processing') {
            throw new Error('Import timed out. Please check import history for results.');
          }
        }
        
        setImportResult(data);
        
        // Clean up uploaded file after successful import
        await supabase.storage.from('imports').remove([actualStoragePath]);
      }
      
      // Save to import history (regardless of success/failure)
      // Skip if this was an async job - edge function already saved it
      if (!data.job_id) {
        try {
          // Prepare preview data from previewData state (first 10 rows)
          const previewDataToSave = previewData ? {
            columns: previewData.columns,
            preview: previewData.preview.slice(0, 10), // First 10 rows
            total_rows: previewData.total_rows
          } : null;

          const { error: historyError } = await supabase
            .from('import_history')
            .insert({
              user_id: user?.id,
              connection_id: selectedConnection,
              filename: sanitizedFilename,
              table_name: importTableName,
              schema_name: importSchema,
              rows_imported: data.rows_imported || 0,
              rows_failed: data.rows_failed || 0,
              total_rows: data.total_rows || 0,
              duplicate_handling: createNewTable ? 'error' : duplicateHandling,
              mapping: activeMapping,
              file_columns: activeFileColumns,
              warnings: data.warnings || [],
              error_summary: data.error_summary || null,
              preview_data: previewDataToSave, // Store preview data
            });

          if (historyError) {
            console.error('Failed to save import history:', historyError);
            // Don't show error to user, just log it
          } else {
            // Reload history
            loadImportHistory();
          }
        } catch (historyErr) {
          console.error('Error saving import history:', historyErr);
        }
      } else {
        // Async job - just reload history to show the updated record
        loadImportHistory();
      }
      
      if (data.success && data.rows_imported > 0) {
        toast({
          title: 'Import successful',
          description: `Imported ${data.rows_imported} rows successfully`,
        });
      } else if (data.rows_failed > 0) {
        // Show error toast with details
        const errorMsg = data.error_summary || data.errors?.[0]?.error || 'Unknown error';
        toast({
          title: 'Import failed',
          description: `${data.rows_failed} rows failed. ${errorMsg.substring(0, 100)}...`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Import completed',
          description: `Imported ${data.rows_imported} rows`,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Import failed',
        description: error.message || 'Failed to import file',
        variant: 'destructive',
      });
      setImportResult({ success: false, error: error.message });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  return (
    <>
      {/* File Parsing Settings Dialog */}
      <Dialog open={parsingDialogOpen} onOpenChange={setParsingDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configure File Parsing Settings</DialogTitle>
            <DialogDescription>
              Adjust how the {currentFileType.toUpperCase()} file should be parsed. Settings are auto-detected, but you can modify them if needed.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Parsing Settings - All in one row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Encoding - Only for CSV and SQL */}
              {(currentFileType === 'csv' || currentFileType === 'sql') && (
                <div className="space-y-1.5">
                  <Label htmlFor="encoding" className="text-xs">Encoding</Label>
                  <Select
                    value={parsingSettings.encoding}
                    onValueChange={(value) => setParsingSettings({ ...parsingSettings, encoding: value })}
                  >
                    <SelectTrigger id="encoding" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utf-8">UTF-8</SelectItem>
                      <SelectItem value="latin-1">Latin-1</SelectItem>
                      <SelectItem value="iso-8859-1">ISO-8859-1</SelectItem>
                      <SelectItem value="cp1252">Windows-1252</SelectItem>
                      <SelectItem value="utf-16">UTF-16</SelectItem>
                    </SelectContent>
                  </Select>
                  {detectedSettings?.encoding && (
                    <p className="text-xs text-muted-foreground">
                      Auto: {detectedSettings.encoding}
                    </p>
                  )}
                </div>
              )}

              {/* Delimiter - Only for CSV */}
              {currentFileType === 'csv' && (
                <div className="space-y-1.5">
                  <Label htmlFor="delimiter" className="text-xs">Delimiter</Label>
                  <Select
                    value={parsingSettings.delimiter}
                    onValueChange={(value) => setParsingSettings({ ...parsingSettings, delimiter: value })}
                  >
                    <SelectTrigger id="delimiter" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value=",">Comma (,)</SelectItem>
                      <SelectItem value=";">Semicolon (;)</SelectItem>
                      <SelectItem value="\t">Tab</SelectItem>
                      <SelectItem value="|">Pipe (|)</SelectItem>
                    </SelectContent>
                  </Select>
                  {detectedSettings?.delimiter && (
                    <p className="text-xs text-muted-foreground">
                      Auto: {detectedSettings.delimiter === ',' ? 'Comma' : detectedSettings.delimiter === ';' ? 'Semicolon' : detectedSettings.delimiter === '\t' ? 'Tab' : detectedSettings.delimiter}
                    </p>
                  )}
                </div>
              )}

              {/* Header Row */}
              <div className="space-y-1.5">
                <Label htmlFor="headerRow" className="text-xs">Header Row</Label>
                <Select
                  value={parsingSettings.headerRow === null ? 'auto' : parsingSettings.headerRow === -1 ? 'none' : String(parsingSettings.headerRow)}
                  onValueChange={(value) => {
                    if (value === 'auto') {
                      setParsingSettings({ ...parsingSettings, headerRow: null });
                    } else if (value === 'none') {
                      setParsingSettings({ ...parsingSettings, headerRow: -1 });
                    } else {
                      setParsingSettings({ ...parsingSettings, headerRow: parseInt(value) });
                    }
                  }}
                >
                  <SelectTrigger id="headerRow" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="0">Row 1</SelectItem>
                    <SelectItem value="1">Row 2</SelectItem>
                    <SelectItem value="2">Row 3</SelectItem>
                    <SelectItem value="none">No headers</SelectItem>
                  </SelectContent>
                </Select>
                {detectedSettings?.headerRow !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Auto: Row {detectedSettings.headerRow + 1}
                  </p>
                )}
              </div>

              {/* Skip Rows */}
              <div className="space-y-1.5">
                <Label htmlFor="skipRows" className="text-xs">Skip Rows</Label>
                <Input
                  id="skipRows"
                  type="number"
                  min="0"
                  value={parsingSettings.skipRows ?? ''}
                  onChange={(e) => setParsingSettings({ 
                    ...parsingSettings, 
                    skipRows: e.target.value ? parseInt(e.target.value) : null 
                  })}
                  placeholder="0"
                  className="h-8 text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Before header
                </p>
              </div>
            </div>

            {/* Preview of first few lines */}
            {previewData && previewData.preview && previewData.preview.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Preview (first {Math.min(2, previewData.preview.length)} rows)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUpdatePreview}
                    disabled={isAnalyzingFile}
                  >
                    {isAnalyzingFile ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      'Update Preview'
                    )}
                  </Button>
                </div>
                <div className="border rounded-md p-2 bg-muted/50 max-h-48 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewData.columns.slice(0, 5).map((col) => (
                          <TableHead key={col} className="text-xs">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.preview.slice(0, 2).map((row, idx) => (
                        <TableRow key={idx}>
                          {previewData.columns.slice(0, 5).map((col) => (
                            <TableCell key={col} className="text-xs">
                              {row[col] !== null && row[col] !== undefined
                                ? String(row[col]).substring(0, 30)
                                : ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setParsingDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApplyParsingSettings}
              disabled={isAnalyzingFile}
            >
              {isAnalyzingFile ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                'Apply Settings & Continue'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Preview Dialog */}
      <Dialog open={historyPreviewDialogOpen} onOpenChange={setHistoryPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
            <DialogDescription>
              Preview of data that was imported on {selectedHistoryItem && new Date(selectedHistoryItem.created_at).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedHistoryItem && selectedHistoryItem.preview_data && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Filename:</span> {selectedHistoryItem.filename}
                </div>
                <div>
                  <span className="font-medium">Table:</span> {selectedHistoryItem.schema_name ? `${selectedHistoryItem.schema_name}.${selectedHistoryItem.table_name}` : selectedHistoryItem.table_name}
                </div>
                <div>
                  <span className="font-medium">Rows Imported:</span> {selectedHistoryItem.rows_imported}
                </div>
                <div>
                  <span className="font-medium">Total Rows in File:</span> {selectedHistoryItem.preview_data.total_rows}
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="p-2 bg-muted">
                  <p className="text-sm font-medium">Preview Data (first {selectedHistoryItem.preview_data.preview.length} rows)</p>
                </div>
                <div className="overflow-x-auto max-h-[60vh]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        {selectedHistoryItem.preview_data.columns.map((col) => (
                          <TableHead key={col} className="whitespace-nowrap">{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedHistoryItem.preview_data.preview.map((row, idx) => (
                        <TableRow key={idx}>
                          {selectedHistoryItem.preview_data.columns.map((col) => (
                            <TableCell key={col} className="whitespace-nowrap">
                              {row[col] !== null && row[col] !== undefined
                                ? String(row[col])
                                : ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedHistoryItem.mapping && Object.keys(selectedHistoryItem.mapping).length > 0 && (
                <div className="border rounded-lg p-4">
                  <p className="text-sm font-medium mb-2">Column Mapping</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(selectedHistoryItem.mapping).map(([fileCol, dbCol]) => (
                      <div key={fileCol} className="flex items-center gap-2">
                        <span className="text-muted-foreground">{fileCol}</span>
                        <span>→</span>
                        <span className="font-medium">{dbCol}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryPreviewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Data Import</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload CSV, Excel, or SQL files and import them into your database tables
          </p>
        </div>

        {/* Cards side by side: Upload File (left) and Import Configuration (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Upload File Card - Left side, first */}
          <div className="space-y-4">
            <div className="mb-2">
              <div className="flex items-center gap-4">
                <div className="flex-1 flex items-center gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Upload File</h2>
                    <p className="text-xs text-muted-foreground">Select a CSV, Excel, SQL, or JSON file to import</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{t('docs.tooltipFileUpload')}</TooltipContent>
                  </Tooltip>
                </div>
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="border-2 border-dashed border-border rounded-lg p-2 flex items-center gap-2 hover:border-primary transition-colors cursor-pointer flex-shrink-0"
                  onClick={() => !file && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,.sql,.json"
                    className="hidden"
                    onChange={(e) => {
                      const selectedFile = e.target.files?.[0];
                      if (selectedFile) {
                        handleFileSelect(selectedFile);
                      }
                    }}
                  />
                  {isAnalyzingFile || isUploading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">
                        {isAnalyzingFile ? 'Analyzing...' : 'Processing...'}
                      </span>
                    </div>
                  ) : file ? (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-xs font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(file.size / 1024 / 1024).toFixed(2)} MB)
                      </span>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile();
                        }}
                        disabled={isAnalyzingFile || isUploading}
                        variant="destructive"
                        size="sm"
                        className="h-6 px-2"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs">Click to upload or drag and drop</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Import Configuration Card - Right side, second */}
          <div className="space-y-4">
            <div className="mb-2">
              <h2 className="text-base font-semibold">Import Configuration</h2>
            </div>
            <div className="space-y-2">
            <div className={`grid grid-cols-1 gap-2 ${
              !createNewTable && schemas.length > 0 
                ? 'sm:grid-cols-3' 
                : !createNewTable 
                  ? 'sm:grid-cols-2' 
                  : 'sm:grid-cols-1'
            }`}>
              <div className="space-y-1">
                <Label className="text-xs">Database Connection</Label>
                <ConnectionDropdown
                  value={selectedConnection}
                  onValueChange={(value) => {
                    setSelectedConnectionLocal(value);
                    selectConnection(value);
                  }}
                  placeholder={t('visualization.selectConnection')}
                  noConnectionsText={t('visualization.noConnectionsSaved')}
                  className="w-full min-w-0 max-w-none"
                />
              </div>

              {!createNewTable && (
                <>
                  {schemas.length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-xs">Schema</Label>
                      <Select value={selectedSchema || '__default__'} onValueChange={(value) => setSelectedSchema(value === '__default__' ? '' : value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select schema" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">Default</SelectItem>
                          {schemas.map((schema) => (
                            <SelectItem key={schema} value={schema}>
                              {schema}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-xs">Target Table</Label>
                    <Select value={selectedTable} onValueChange={setSelectedTable}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select table" />
                      </SelectTrigger>
                      <SelectContent>
                        {tables.map((table) => (
                          <SelectItem key={table} value={table}>
                            {table}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* Create New Table Checkbox */}
            <div 
              className="flex items-center space-x-2 p-2 border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer" 
              onClick={() => setCreateNewTable(!createNewTable)}
            >
              <Checkbox
                id="create-new-table"
                checked={createNewTable}
                onCheckedChange={(checked) => {
                  setCreateNewTable(checked === true);
                  if (checked) {
                    setSelectedTable('');
                  }
                }}
              />
              <Label
                htmlFor="create-new-table"
                className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
              >
                Create New Table
              </Label>
              <Plus className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </div>
        </div>

        {/* New Table Configuration - Only shown when createNewTable is true, after Upload File */}
        {createNewTable && fileColumns.length > 0 && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">New Table Configuration</h2>
              <p className="text-sm text-muted-foreground">Configure the new table that will be created and import data in one step</p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {schemas.length > 0 && (
                  <div className="space-y-2">
                    <Label>Schema (optional)</Label>
                    <Select
                      value={newTableSchema || '__default__'}
                      onValueChange={async (value) => {
                        const schema = value === '__default__' ? '' : value;
                        setNewTableSchema(schema);
                        // Re-check table name when schema changes
                        if (newTableName.trim() && selectedConnection) {
                          setTableNameError(null);
                          setIsCheckingTableName(true);
                          try {
                            const { data, error } = await supabase.functions.invoke('database-proxy', {
                              body: {
                                endpoint: '/tables',
                                connectionId: selectedConnection,
                              }
                            });
                            
                            if (!error && data?.tables) {
                              const tableExists = data.tables.some((t: any) => 
                                t.name.toLowerCase() === newTableName.trim().toLowerCase() && 
                                (t.schema || '') === schema
                              );
                              
                              if (tableExists) {
                                setTableNameError(`Table "${newTableName.trim()}" already exists in ${schema || 'default'} schema`);
                              }
                            }
                          } catch (err) {
                            console.error('Error checking table name:', err);
                          } finally {
                            setIsCheckingTableName(false);
                          }
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select schema" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">Default</SelectItem>
                        {schemas.map((schema) => (
                          <SelectItem key={schema} value={schema}>
                            {schema}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>New Table Name</Label>
                  <Input
                    value={newTableName}
                    onChange={async (e) => {
                      const name = e.target.value;
                      setNewTableName(name);
                      setTableNameError(null);
                      
                      // Check if table exists when name is entered and connection is selected
                      if (name.trim() && selectedConnection) {
                        setIsCheckingTableName(true);
                        try {
                          const { data, error } = await supabase.functions.invoke('database-proxy', {
                            body: {
                              endpoint: '/tables',
                              connectionId: selectedConnection,
                            }
                          });
                          
                          if (!error && data?.tables) {
                            const schema = newTableSchema || '';
                            const tableExists = data.tables.some((t: any) => 
                              t.name.toLowerCase() === name.trim().toLowerCase() && 
                              (t.schema || '') === schema
                            );
                            
                            if (tableExists) {
                              setTableNameError(`Table "${name.trim()}" already exists in ${schema || 'default'} schema`);
                            }
                          }
                        } catch (err) {
                          console.error('Error checking table name:', err);
                        } finally {
                          setIsCheckingTableName(false);
                        }
                      }
                    }}
                    placeholder="Enter table name"
                    className={tableNameError ? 'border-destructive' : ''}
                  />
                  {isCheckingTableName && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking table name...
                    </p>
                  )}
                  {tableNameError && (
                    <p className="text-xs text-destructive">{tableNameError}</p>
                  )}
                </div>
              </div>

              {/* Column Types Configuration - Inline, no dialog */}
              <div className="space-y-2">
                <Label>Column Types</Label>
                <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-4">
                  {fileColumns
                    .filter((col) => !hiddenColumns.has(col.name))
                    .map((col) => {
                      const newColumnName = columnNames[col.name] || col.name;
                      return (
                        <div key={col.name} className="flex items-start gap-4">
                          <div className="flex-1">
                            <Label htmlFor={`col-name-${col.name}`} className="text-xs">Column Name</Label>
                            <Input
                              id={`col-name-${col.name}`}
                              value={newColumnName}
                              onChange={(e) => {
                                const newName = e.target.value.trim();
                                setColumnNames((prev) => ({
                                  ...prev,
                                  [col.name]: newName || col.name, // Fallback to original if empty
                                }));
                              }}
                              placeholder={col.name}
                              className="h-8 text-xs"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Source: {col.name} · Detected: {col.type}
                            </p>
                          </div>
                          <div className="flex-1">
                            <Label htmlFor={`col-type-${col.name}`} className="text-xs">Type</Label>
                            <Select
                              value={columnTypes[col.name] || col.type}
                              onValueChange={(value) => {
                                setColumnTypes((prev) => ({
                                  ...prev,
                                  [col.name]: value,
                                }));
                              }}
                            >
                              <SelectTrigger id={`col-type-${col.name}`} className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="TEXT">TEXT</SelectItem>
                                <SelectItem value="INTEGER">INTEGER</SelectItem>
                                <SelectItem value="REAL">REAL</SelectItem>
                                <SelectItem value="NUMERIC">NUMERIC</SelectItem>
                                <SelectItem value="DATE">DATE</SelectItem>
                                <SelectItem value="DATETIME">DATETIME</SelectItem>
                                <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                                <SelectItem value="VARCHAR(255)">VARCHAR(255)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {/* Constraint Badges */}
                          <div className="flex gap-1 mt-6 flex-wrap">
                            {columnConstraints[col.name]?.primaryKey && <Badge variant="secondary" className="text-xs px-1">PK</Badge>}
                            {columnConstraints[col.name]?.notNull && !columnConstraints[col.name]?.primaryKey && <Badge variant="secondary" className="text-xs px-1">NN</Badge>}
                            {columnConstraints[col.name]?.unique && <Badge variant="secondary" className="text-xs px-1">UQ</Badge>}
                            {columnConstraints[col.name]?.foreignKeyTable && <Badge variant="secondary" className="text-xs px-1">FK</Badge>}
                            {columnConstraints[col.name]?.defaultValue && <Badge variant="outline" className="text-xs px-1">DEF</Badge>}
                          </div>

                          {/* Constraint Popover */}
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 mt-6">
                                <Settings2 className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 space-y-3" align="end">
                              <p className="text-sm font-medium">Constraints – {columnNames[col.name] || col.name}</p>

                              {/* Primary Key */}
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`pk-${col.name}`}
                                  checked={!!columnConstraints[col.name]?.primaryKey}
                                  onCheckedChange={(checked) =>
                                    setColumnConstraints((prev) => ({
                                      ...prev,
                                      [col.name]: { ...prev[col.name], primaryKey: !!checked, notNull: !!checked },
                                    }))
                                  }
                                />
                                <Label htmlFor={`pk-${col.name}`} className="text-xs">Primary Key</Label>
                              </div>

                              {/* NOT NULL */}
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`nn-${col.name}`}
                                  checked={!!columnConstraints[col.name]?.notNull}
                                  disabled={!!columnConstraints[col.name]?.primaryKey}
                                  onCheckedChange={(checked) =>
                                    setColumnConstraints((prev) => ({
                                      ...prev,
                                      [col.name]: { ...prev[col.name], notNull: !!checked },
                                    }))
                                  }
                                />
                                <Label htmlFor={`nn-${col.name}`} className="text-xs">NOT NULL</Label>
                              </div>

                              {/* UNIQUE */}
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`uq-${col.name}`}
                                  checked={!!columnConstraints[col.name]?.unique}
                                  onCheckedChange={(checked) =>
                                    setColumnConstraints((prev) => ({
                                      ...prev,
                                      [col.name]: { ...prev[col.name], unique: !!checked },
                                    }))
                                  }
                                />
                                <Label htmlFor={`uq-${col.name}`} className="text-xs">UNIQUE</Label>
                              </div>

                              {/* DEFAULT */}
                              <div className="space-y-1">
                                <Label className="text-xs">DEFAULT value</Label>
                                <Input
                                  className="h-7 text-xs"
                                  placeholder="e.g. 0, NOW(), 'active'"
                                  value={columnConstraints[col.name]?.defaultValue || ''}
                                  onChange={(e) =>
                                    setColumnConstraints((prev) => ({
                                      ...prev,
                                      [col.name]: { ...prev[col.name], defaultValue: e.target.value },
                                    }))
                                  }
                                />
                              </div>

                              {/* Foreign Key */}
                              <div className="space-y-1">
                                <Label className="text-xs">Foreign Key → Table</Label>
                                <Select
                                  value={columnConstraints[col.name]?.foreignKeyTable || ''}
                                  onValueChange={async (tbl) => {
                                    setColumnConstraints((prev) => ({
                                      ...prev,
                                      [col.name]: { ...prev[col.name], foreignKeyTable: tbl, foreignKeyColumn: '' },
                                    }));
                                    await fetchColumnsForFkTable(tbl);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select table" /></SelectTrigger>
                                  <SelectContent>
                                    {tables.map((tbl) => <SelectItem key={tbl} value={tbl}>{tbl}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>

                              {columnConstraints[col.name]?.foreignKeyTable && (
                                <div className="space-y-1">
                                  <Label className="text-xs">Foreign Key → Column</Label>
                                  <Select
                                    value={columnConstraints[col.name]?.foreignKeyColumn || ''}
                                    onValueChange={(fkCol) =>
                                      setColumnConstraints((prev) => ({
                                        ...prev,
                                        [col.name]: { ...prev[col.name], foreignKeyColumn: fkCol },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
                                    <SelectContent>
                                      {(fkColumnCache[columnConstraints[col.name].foreignKeyTable] || []).map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </PopoverContent>
                          </Popover>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setHiddenColumns((prev) => {
                                const newSet = new Set(prev);
                                newSet.add(col.name);
                                return newSet;
                              });
                              // Remove column name mapping when column is hidden
                              setColumnNames((prev) => {
                                const newNames = { ...prev };
                                delete newNames[col.name];
                                return newNames;
                              });
                            }}
                            className="h-8 w-8 mt-6"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}
                </div>
                {hiddenColumns.size > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Restore column:</span>
                    <Select
                      onValueChange={(value) => {
                        setHiddenColumns((prev) => {
                          const newSet = new Set(prev);
                          newSet.delete(value);
                          return newSet;
                        });
                      }}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select column to restore" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(hiddenColumns).map((colName) => {
                          const col = fileColumns.find((c) => c.name === colName);
                          return (
                            <SelectItem key={colName} value={colName}>
                              {colName} ({col?.type || 'unknown'})
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Column Mapping Section - Two Tables Side by Side - Only shown when NOT creating new table */}
        {!createNewTable && fileColumns.length > 0 && (
          <div className="space-y-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Column Mapping</h2>
              <p className="text-sm text-muted-foreground">
                Map your file columns to database columns. Left: File columns with detected types. Right: Target database columns.
              </p>
            </div>
            <div>
              {!selectedTable ? (
                <div className="flex items-center justify-center py-12 text-center">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Please select a target table or enable "Create New Table" to configure column mapping.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Table: File Columns */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">File Columns</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Column Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="w-[50px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fileColumns
                          .filter((col) => !hiddenColumns.has(col.name))
                          .map((col) => (
                            <TableRow key={col.name} className="h-[60px]">
                              <TableCell className="font-medium align-middle py-2">{col.name}</TableCell>
                              <TableCell className="align-middle py-2">
                                <Select
                                  value={col.type}
                                  onValueChange={(value) => {
                                    setFileColumns((prev) =>
                                      prev.map((c) => (c.name === col.name ? { ...c, type: value } : c))
                                    );
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="TEXT">TEXT</SelectItem>
                                    <SelectItem value="INTEGER">INTEGER</SelectItem>
                                    <SelectItem value="REAL">REAL</SelectItem>
                                    <SelectItem value="NUMERIC">NUMERIC</SelectItem>
                                    <SelectItem value="DATE">DATE</SelectItem>
                                    <SelectItem value="DATETIME">DATETIME</SelectItem>
                                    <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                                    <SelectItem value="VARCHAR(255)">VARCHAR(255)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="align-middle py-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setHiddenColumns((prev) => {
                                      const newSet = new Set(prev);
                                      newSet.add(col.name);
                                      return newSet;
                                    });
                                    // Also remove from mapping if it was mapped
                                    setMapping((prev) => {
                                      const newMapping = { ...prev };
                                      delete newMapping[col.name];
                                      return newMapping;
                                    });
                                  }}
                                  className="h-8 w-8"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                      {hiddenColumns.size > 0 && (
                        <tfoot>
                          <TableRow>
                            <TableCell colSpan={3} className="py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Restore column:</span>
                                <Select
                                  onValueChange={(value) => {
                                    setHiddenColumns((prev) => {
                                      const newSet = new Set(prev);
                                      newSet.delete(value);
                                      return newSet;
                                    });
                                  }}
                                >
                                  <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select column to restore" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from(hiddenColumns).map((colName) => {
                                      const col = fileColumns.find((c) => c.name === colName);
                                      return (
                                        <SelectItem key={colName} value={colName}>
                                          {colName} ({col?.type || 'unknown'})
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>
                            </TableCell>
                          </TableRow>
                        </tfoot>
                      )}
                    </Table>
                  </div>
                </div>

                {/* Right Table: Target Columns */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Target Columns</h3>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Target Column</TableHead>
                          <TableHead>Type</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fileColumns
                          .filter((col) => !hiddenColumns.has(col.name))
                          .map((col, idx) => (
                            <TableRow key={col.name} className="h-[60px]">
                            <TableCell className="align-middle py-2">
                              {!createNewTable && selectedTable ? (
                                // Existing table: Show dropdown with DB columns
                                <Select
                                  value={mapping[col.name] || '__skip__'}
                                  onValueChange={(value) => {
                                    setMapping((prev) => ({
                                      ...prev,
                                      [col.name]: value === '__skip__' ? '' : value,
                                    }));
                                  }}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select column" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__skip__">-- Skip --</SelectItem>
                                    {dbColumns.length > 0 ? (
                                      dbColumns.map((dbCol) => {
                                        const dbColInfo = dbColumnsWithTypes.find(c => c.name === dbCol);
                                        return (
                                          <SelectItem key={dbCol} value={dbCol}>
                                            <div className="flex items-center justify-between w-full">
                                              <span>{dbCol}</span>
                                              {dbColInfo && (
                                                <Badge variant="outline" className="ml-2 text-xs">
                                                  {dbColInfo.type}
                                                </Badge>
                                              )}
                                            </div>
                                          </SelectItem>
                                        );
                                      })
                                    ) : selectedTable ? (
                                      <SelectItem value="__loading__" disabled>
                                        Loading columns...
                                      </SelectItem>
                                    ) : (
                                      <SelectItem value="__no_table__" disabled>
                                        Select a table first
                                      </SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                              ) : (
                                // New table: Show type selector
                                <div className="space-y-2">
                                  <Select
                                    value={columnTypes[col.name] || col.type}
                                    onValueChange={(value) => {
                                      setColumnTypes((prev) => ({
                                        ...prev,
                                        [col.name]: value,
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="TEXT">TEXT</SelectItem>
                                      <SelectItem value="INTEGER">INTEGER</SelectItem>
                                      <SelectItem value="REAL">REAL</SelectItem>
                                      <SelectItem value="NUMERIC">NUMERIC</SelectItem>
                                      <SelectItem value="DATE">DATE</SelectItem>
                                      <SelectItem value="DATETIME">DATETIME</SelectItem>
                                      <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                                      <SelectItem value="VARCHAR(255)">VARCHAR(255)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="align-middle py-2">
                              {!createNewTable && selectedTable ? (
                                mapping[col.name] ? (
                                  <div className="space-y-1">
                                    <Badge variant="default">Mapped</Badge>
                                    {dbColumnsWithTypes.find(dbCol => dbCol.name === mapping[col.name]) && (
                                      <p className="text-xs text-muted-foreground">
                                        {dbColumnsWithTypes.find(dbCol => dbCol.name === mapping[col.name])?.type}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <Badge variant="outline">Not mapped</Badge>
                                )
                              ) : (
                                <Badge variant="outline">{columnTypes[col.name] || col.type}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {hiddenColumns.size > 0 && (
                        <tfoot>
                          <TableRow>
                            <TableCell colSpan={2} className="py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Restore column:</span>
                                <Select
                                  onValueChange={(value) => {
                                    setHiddenColumns((prev) => {
                                      const newSet = new Set(prev);
                                      newSet.delete(value);
                                      return newSet;
                                    });
                                  }}
                                >
                                  <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select column to restore" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from(hiddenColumns).map((colName) => {
                                      const col = fileColumns.find((c) => c.name === colName);
                                      return (
                                        <SelectItem key={colName} value={colName}>
                                          {colName} ({col?.type || 'unknown'})
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>
                            </TableCell>
                          </TableRow>
                        </tfoot>
                      )}
                    </Table>
                  </div>
                </div>
                </div>
              )}

              {/* Preview Button */}
              <div className="mt-6 flex justify-end">
                <Button
                  onClick={handlePreview}
                  disabled={
                    isUploading || 
                    !selectedConnection || 
                    (!createNewTable && selectedTable && Object.keys(mapping).filter(k => mapping[k]).length === 0) ||
                    (createNewTable && !newTableName.trim())
                  }
                  variant="default"
                  size="lg"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading Preview...
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" />
                      Preview Data
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Data Preview Section - Shows actual data after preview */}
        {previewData && (
          <>
            <div className="space-y-4">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Data Preview</h2>
                <p className="text-sm text-muted-foreground">
                  {previewData.total_rows} rows, {previewData.columns.length} columns
                </p>
              </div>
              <div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewData.columns.map((col) => (
                          <TableHead key={col}>{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.preview.slice(0, 10).map((row, idx) => (
                        <TableRow key={idx}>
                          {previewData.columns.map((col) => (
                            <TableCell key={col}>
                              {row[col] !== null && row[col] !== undefined
                                ? String(row[col])
                                : ''}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            {previewData && (selectedTable || (createNewTable && newTableName.trim())) && (
              <div className="space-y-4">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">Import</h2>
                </div>
                <div className="space-y-4">
                  {/* Duplicate Handling Option - only show for existing tables */}
                  {!createNewTable && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Handle Duplicate Rows</Label>
                      <Select
                        value={duplicateHandling}
                        onValueChange={(value: 'error' | 'skip' | 'update') => setDuplicateHandling(value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="error">Fail on duplicates (default)</SelectItem>
                          <SelectItem value="skip">Skip duplicate rows</SelectItem>
                          <SelectItem value="update">Update existing rows</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {duplicateHandling === 'error' && 'Import will fail if duplicate keys are found'}
                        {duplicateHandling === 'skip' && 'Rows with duplicate keys will be ignored'}
                        {duplicateHandling === 'update' && 'Rows with duplicate keys will update existing records'}
                      </p>
                    </div>
                  )}
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleImport}
                        disabled={isImporting || (!createNewTable && !selectedTable) || (createNewTable && (!newTableName.trim() || !!tableNameError)) || (!createNewTable && Object.keys(mapping).length === 0)}
                        className="w-full"
                        size="lg"
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {createNewTable ? 'Creating table and importing...' : 'Importing...'}
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            {createNewTable ? 'Create Table & Import Data' : 'Import Data'}
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('docs.tooltipStartImport')}</TooltipContent>
                  </Tooltip>

                {importResult && (
                  <Alert variant={importResult.success && importResult.rows_imported > 0 ? 'default' : 'destructive'}>
                    {importResult.success && importResult.rows_imported > 0 ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    <AlertDescription>
                      {importResult.success && importResult.rows_imported > 0 ? (
                        <div className="space-y-2">
                          <p className="font-medium">
                            Successfully imported {importResult.rows_imported} rows
                          </p>
                          {importResult.rows_failed > 0 && (
                            <div className="mt-2 space-y-2">
                              <p className="text-sm font-medium text-destructive">
                                {importResult.rows_failed} rows failed
                              </p>
                              {importResult.error_summary && (
                                <div className="mt-2">
                                  <p className="text-sm font-medium">Error Summary:</p>
                                  <p className="text-sm text-muted-foreground">{importResult.error_summary}</p>
                                </div>
                              )}
                              {importResult.errors && importResult.errors.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-sm font-medium">Detailed Errors (showing first {Math.min(importResult.errors.length, 10)}):</p>
                                  <ul className="list-disc list-inside text-sm text-muted-foreground max-h-40 overflow-y-auto">
                                    {importResult.errors.slice(0, 10).map((err: any, idx: number) => (
                                      <li key={idx}>
                                        {err.row !== undefined ? `Row ${err.row}: ` : ''}{err.error || err}
                                      </li>
                                    ))}
                                  </ul>
                                  {importResult.errors.length > 10 && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      ... and {importResult.errors.length - 10} more errors
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {importResult.warnings && importResult.warnings.length > 0 && (
                            <div className="mt-2">
                              <p className="text-sm font-medium">Warnings:</p>
                              <ul className="list-disc list-inside text-sm text-muted-foreground">
                                {importResult.warnings.map((w: string, idx: number) => (
                                  <li key={idx}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="font-medium">
                            Import failed: {importResult.rows_imported} rows imported, {importResult.rows_failed} rows failed
                          </p>
                          {importResult.error_summary && (
                            <div className="mt-2">
                              <p className="text-sm font-medium">Error Summary:</p>
                              <p className="text-sm text-muted-foreground">{importResult.error_summary}</p>
                            </div>
                          )}
                          {importResult.errors && importResult.errors.length > 0 && (
                            <div className="mt-2">
                              <p className="text-sm font-medium">Detailed Errors (showing first {Math.min(importResult.errors.length, 10)}):</p>
                              <ul className="list-disc list-inside text-sm text-muted-foreground max-h-40 overflow-y-auto">
                                {importResult.errors.slice(0, 10).map((err: any, idx: number) => (
                                  <li key={idx}>
                                    Row {err.row}: {err.error}
                                  </li>
                                ))}
                              </ul>
                              {importResult.errors.length > 10 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  ... and {importResult.errors.length - 10} more errors
                                </p>
                              )}
                            </div>
                          )}
                          {importResult.warnings && importResult.warnings.length > 0 && (
                            <div className="mt-2">
                              <p className="text-sm font-medium">Warnings:</p>
                              <ul className="list-disc list-inside text-sm text-muted-foreground">
                                {importResult.warnings.map((w: string, idx: number) => (
                                  <li key={idx}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {!importResult.errors || importResult.errors.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {importResult.error || 'No detailed error information available'}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
            )}
          </>
        )}

        {/* Create Table Dialog */}
        <Dialog 
          open={createTableDialogOpen} 
          onOpenChange={(open) => {
            // Only allow closing the dialog, not creating table on open
            if (!open) {
              setCreateTableDialogOpen(false);
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Table</DialogTitle>
              <DialogDescription>
                Create a new table based on your CSV/Excel file columns
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Table Name</Label>
                <Input
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="Enter table name"
                />
              </div>

              {schemas.length > 0 && (
                <div className="space-y-2">
                  <Label>Schema (optional)</Label>
                  <Select
                    value={newTableSchema || '__default__'}
                    onValueChange={(value) => setNewTableSchema(value === '__default__' ? '' : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select schema" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Default</SelectItem>
                      {schemas.map((schema) => (
                        <SelectItem key={schema} value={schema}>
                          {schema}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(previewData?.columns || fileColumns.length > 0) && (
                <div className="space-y-2">
                  <Label>Column Types</Label>
                  <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-4">
                    {(previewData?.columns || fileColumns.map(c => c.name)).map((col) => (
                      <div key={col} className="flex items-center gap-4">
                        <div className="flex-1">
                          <Label className="text-sm font-medium">{col}</Label>
                          {fileColumns.find(fc => fc.name === col) && (
                            <p className="text-xs text-muted-foreground">
                              Detected: {fileColumns.find(fc => fc.name === col)?.type || 'TEXT'}
                            </p>
                          )}
                        </div>
                        <div className="flex-1">
                          <Select
                            value={columnTypes[col] || fileColumns.find(fc => fc.name === col)?.type || 'TEXT'}
                            onValueChange={(value) => {
                              setColumnTypes((prev) => ({
                                ...prev,
                                [col]: value,
                              }));
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="TEXT">TEXT</SelectItem>
                              <SelectItem value="INTEGER">INTEGER</SelectItem>
                              <SelectItem value="REAL">REAL</SelectItem>
                              <SelectItem value="NUMERIC">NUMERIC</SelectItem>
                              <SelectItem value="DATE">DATE</SelectItem>
                              <SelectItem value="DATETIME">DATETIME</SelectItem>
                              <SelectItem value="BOOLEAN">BOOLEAN</SelectItem>
                              <SelectItem value="VARCHAR(255)">VARCHAR(255)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCreateTableDialogOpen(false);
                  setNewTableName('');
                  setNewTableSchema('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTable}
                disabled={!newTableName.trim() || isCreatingTable}
              >
                {isCreatingTable ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Table
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import History */}
        <div className="space-y-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Import History</h2>
            <p className="text-sm text-muted-foreground">
              Recent data imports and their results
            </p>
          </div>
          <div>
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : importHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No import history yet. Your imports will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="max-h-[200px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Filename</TableHead>
                        <TableHead>Table</TableHead>
                        <TableHead>Rows</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Duplicate Handling</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importHistory.map((history) => {
                      const success = history.rows_imported > 0;
                      const date = new Date(history.created_at);
                      const tableDisplay = history.schema_name 
                        ? `${history.schema_name}.${history.table_name}`
                        : history.table_name;
                      
                      return (
                        <TableRow 
                          key={history.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            if (history.preview_data) {
                              setSelectedHistoryItem(history);
                              setHistoryPreviewDialogOpen(true);
                            }
                          }}
                        >
                          <TableCell className="text-sm">
                            {date.toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {history.filename}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {tableDisplay}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm">
                                {history.rows_imported} imported
                              </span>
                              {history.rows_failed > 0 && (
                                <span className="text-xs text-destructive">
                                  {history.rows_failed} failed
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {success ? (
                              <Badge variant="default" className="bg-green-500">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Success
                              </Badge>
                            ) : (
                              <Badge variant="destructive">
                                <XCircle className="h-3 w-3 mr-1" />
                                Failed
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {history.duplicate_handling === 'error' ? 'Fail on duplicates' :
                               history.duplicate_handling === 'skip' ? 'Skip duplicates' :
                               history.duplicate_handling === 'update' ? 'Update duplicates' :
                               history.duplicate_handling}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    </TableBody>
                  </Table>
                </div>
                {importHistory.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Scroll to see {importHistory.length - 3} more entries
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
    </>
  );
};

export default DataImport;
